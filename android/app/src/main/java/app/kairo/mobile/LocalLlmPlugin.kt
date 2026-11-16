package app.kairo.mobile

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.PowerManager
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.MessageCallback
import com.google.ai.edge.litertlm.SamplerConfig
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors

/**
 * IA locale sur le téléphone : Gemma 4 E2B via LiteRT-LM (Google AI Edge).
 * - download / status : télécharge le modèle (~2,6 Go) avec le gestionnaire de
 *   téléchargements d'Android (continue même si l'app est fermée).
 * - generate : génère une réponse en streaming (événements "token").
 */
@CapacitorPlugin(name = "LocalLlm")
class LocalLlmPlugin : Plugin() {

  companion object {
    const val MODEL_NAME = "gemma-4-E2B-it.litertlm"
    const val MODEL_URL =
      "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm"
    const val PREFS = "kairo_llm"
  }

  private val worker = Executors.newSingleThreadExecutor()
  @Volatile private var engine: Engine? = null
  @Volatile private var conversation: Conversation? = null
  @Volatile private var backendName = ""
  @Volatile private var cancelled = false

  // Téléchargement direct (dans l'app), utilisé en 4G si Android bloque le gestionnaire.
  @Volatile private var directActive = false
  @Volatile private var directStop = false
  @Volatile private var directReceived = 0L
  @Volatile private var directTotal = 0L
  @Volatile private var directError = ""
  private var directThread: Thread? = null

  private fun modelDir(): File = File(context.getExternalFilesDir(null) ?: context.filesDir, "models").apply { mkdirs() }
  private fun modelFile() = File(modelDir(), MODEL_NAME)
  private fun partFile() = File(modelDir(), "$MODEL_NAME.download")
  private fun prefs() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private fun dm() = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

  // ---------------------------------------------------------------- Modèle

  @PluginMethod
  fun status(call: PluginCall) {
    val out = JSObject()
    val file = modelFile()
    val id = prefs().getLong("downloadId", -1L)
    var state = if (file.exists() && file.length() > 0) "ready" else "missing"
    var received = 0L
    var total = 0L
    var error = ""
    var reason = 0
    if (state != "ready" && directActive) {
      state = "downloading"
      received = directReceived
      total = directTotal
    } else if (state != "ready" && directError.isNotEmpty()) {
      error = directError
      directError = ""
      received = partFile().length()
    }
    if (state != "ready" && !directActive && id >= 0) {
      dm().query(DownloadManager.Query().setFilterById(id))?.use { c ->
        if (c.moveToFirst()) {
          val st = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
          received = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
          total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
          when (st) {
            DownloadManager.STATUS_SUCCESSFUL -> {
              if (partFile().exists() && partFile().renameTo(file)) state = "ready"
              else if (file.exists()) state = "ready"
              else { state = "missing"; error = "Fichier téléchargé introuvable." }
              prefs().edit().remove("downloadId").apply()
            }
            DownloadManager.STATUS_FAILED -> {
              val reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
              state = "missing"
              error = "Téléchargement échoué (code $reason). Vérifie la connexion et l’espace libre."
              prefs().edit().remove("downloadId").apply()
              partFile().delete()
            }
            DownloadManager.STATUS_PAUSED -> {
              state = "paused"
              reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
            }
            else -> state = "downloading"
          }
        } else {
          prefs().edit().remove("downloadId").apply()
        }
      }
    }
    if (state == "missing" && !directActive && prefs().getLong("downloadId", -1L) < 0 && partFile().exists()) {
      received = partFile().length() // téléchargement direct interrompu : reprise possible
    }
    out.put("state", state)
    out.put("received", received)
    out.put("total", total)
    out.put("size", if (file.exists()) file.length() else 0L)
    out.put("loaded", engine != null)
    out.put("backend", backendName)
    out.put("freeBytes", modelDir().usableSpace)
    out.put("reason", reason)
    out.put("mobileData", prefs().getBoolean("mobileData", false))
    out.put("mode", if (directActive) "direct" else if (id >= 0) "manager" else "")
    if (error.isNotEmpty()) out.put("error", error)
    call.resolve(out)
  }

  @PluginMethod
  fun download(call: PluginCall) {
    if (modelFile().exists()) { call.resolve(JSObject().put("state", "ready")); return }
    if (prefs().getLong("downloadId", -1L) >= 0) { call.resolve(JSObject().put("state", "downloading")); return }
    if (directActive) { call.resolve(JSObject().put("state", "downloading")); return }
    val mobile = call.getBoolean("allowMobileData", false) ?: false
    partFile().delete()
    val req = DownloadManager.Request(Uri.parse(call.getString("url") ?: MODEL_URL))
      .setTitle("Kairo · modèle d’IA")
      .setDescription("Gemma 4 E2B (2,6 Go)")
      .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
      .setAllowedNetworkTypes(
        if (mobile) DownloadManager.Request.NETWORK_WIFI or DownloadManager.Request.NETWORK_MOBILE
        else DownloadManager.Request.NETWORK_WIFI
      )
      .setAllowedOverMetered(mobile)
      .setAllowedOverRoaming(false)
      .setDestinationUri(Uri.fromFile(partFile()))
    val id = dm().enqueue(req)
    prefs().edit().putLong("downloadId", id).putBoolean("mobileData", mobile).apply()
    call.resolve(JSObject().put("state", "downloading"))
  }

  /** Téléchargement direct par l'app (Wi-Fi ou 4G), reprend là où il s'était arrêté. */
  @PluginMethod
  fun downloadDirect(call: PluginCall) {
    if (modelFile().exists()) { call.resolve(JSObject().put("state", "ready")); return }
    if (directActive) { call.resolve(JSObject().put("state", "downloading")); return }
    // Arrête un éventuel téléchargement du gestionnaire Android.
    val id = prefs().getLong("downloadId", -1L)
    if (id >= 0) { dm().remove(id); prefs().edit().remove("downloadId").apply(); partFile().delete() }
    prefs().edit().putBoolean("mobileData", true).apply()
    val url = call.getString("url") ?: MODEL_URL
    directStop = false
    directError = ""
    directActive = true
    directReceived = partFile().length()
    directTotal = 0L
    directThread = Thread {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      val lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kairo:model-download")
      lock.acquire(3 * 60 * 60 * 1000L)
      try {
        var attempt = 0
        while (true) {
          try {
            directOnce(url)
            break
          } catch (t: Throwable) {
            if (directStop) throw t
            attempt++
            if (attempt > 5) throw t
            Thread.sleep(3000L * attempt) // coupure réseau : on réessaie en reprenant
          }
        }
        if (!directStop) {
          if (!partFile().renameTo(modelFile())) throw IllegalStateException("Impossible de finaliser le fichier.")
        }
      } catch (t: Throwable) {
        if (!directStop) directError = "Téléchargement interrompu : ${t.message ?: "erreur réseau"}. Relance pour reprendre où il s’est arrêté."
      } finally {
        directActive = false
        if (lock.isHeld) lock.release()
      }
    }.apply { isDaemon = true; start() }
    call.resolve(JSObject().put("state", "downloading"))
  }

  private fun directOnce(url: String) {
    val part = partFile()
    val start = if (part.exists()) part.length() else 0L
    var conn = URL(url).openConnection() as HttpURLConnection
    conn.instanceFollowRedirects = true
    conn.connectTimeout = 20000
    conn.readTimeout = 60000
    if (start > 0) conn.setRequestProperty("Range", "bytes=$start-")
    var code = conn.responseCode
    // Suit manuellement les redirections entre domaines (Hugging Face → CDN).
    var hops = 0
    while (code in 300..399 && hops < 5) {
      val loc = conn.getHeaderField("Location") ?: break
      conn.disconnect()
      conn = URL(URL(url), loc).openConnection() as HttpURLConnection
      conn.connectTimeout = 20000
      conn.readTimeout = 60000
      if (start > 0) conn.setRequestProperty("Range", "bytes=$start-")
      code = conn.responseCode
      hops++
    }
    if (code == 416) return // déjà complet
    if (code !in 200..299) throw IllegalStateException("HTTP $code")
    val append = code == 206 && start > 0
    if (!append) part.delete()
    val len = conn.contentLengthLong
    directTotal = if (len > 0) (if (append) start + len else len) else 0L
    directReceived = if (append) start else 0L
    conn.inputStream.use { input ->
      FileOutputStream(part, append).use { out ->
        val buf = ByteArray(256 * 1024)
        while (true) {
          if (directStop) throw InterruptedException("annulé")
          val n = input.read(buf)
          if (n < 0) break
          out.write(buf, 0, n)
          directReceived += n
        }
      }
    }
    conn.disconnect()
    if (directTotal > 0 && part.length() < directTotal) throw IllegalStateException("fichier incomplet")
  }

  @PluginMethod
  fun cancelDownload(call: PluginCall) {
    directStop = true
    directThread?.join(3000)
    directActive = false
    val id = prefs().getLong("downloadId", -1L)
    if (id >= 0) dm().remove(id)
    prefs().edit().remove("downloadId").apply()
    partFile().delete()
    call.resolve()
  }

  @PluginMethod
  fun deleteModel(call: PluginCall) {
    worker.execute {
      closeAll()
      modelFile().delete()
      partFile().delete()
      call.resolve()
    }
  }

  // ---------------------------------------------------------------- Moteur

  private fun closeAll() {
    try { conversation?.close() } catch (_: Throwable) {}
    conversation = null
    try { engine?.close() } catch (_: Throwable) {}
    engine = null
    backendName = ""
  }

  private fun ensureEngine(): Engine {
    engine?.let { return it }
    val path = modelFile().absolutePath
    if (!modelFile().exists()) throw IllegalStateException("Modèle non téléchargé.")
    val attempts = listOf<Pair<String, () -> EngineConfig>>(
      "GPU" to { EngineConfig(modelPath = path, backend = Backend.GPU(), visionBackend = Backend.GPU(), maxNumTokens = 4096, maxNumImages = 1, cacheDir = context.cacheDir.path) },
      "CPU" to { EngineConfig(modelPath = path, backend = Backend.CPU(), visionBackend = Backend.CPU(), maxNumTokens = 4096, maxNumImages = 1, cacheDir = context.cacheDir.path) },
    )
    var last: Throwable? = null
    for ((name, cfg) in attempts) {
      try {
        val e = Engine(cfg())
        e.initialize()
        engine = e
        backendName = name
        return e
      } catch (t: Throwable) {
        last = t
      }
    }
    throw IllegalStateException("Impossible de charger le modèle : ${last?.message}", last)
  }

  @PluginMethod
  fun load(call: PluginCall) {
    worker.execute {
      try {
        ensureEngine()
        call.resolve(JSObject().put("backend", backendName))
      } catch (t: Throwable) {
        call.reject(t.message ?: "Erreur de chargement")
      }
    }
  }

  @PluginMethod
  fun unload(call: PluginCall) {
    worker.execute { closeAll(); call.resolve() }
  }

  /**
   * Paramètres : id, system, history [{role:'user'|'assistant', text}], text, image (base64 JPEG, optionnel).
   * Émet "token" {id, text} pour chaque morceau ; résout {text, cancelled}.
   */
  @PluginMethod
  fun generate(call: PluginCall) {
    val id = call.getString("id") ?: ""
    val system = call.getString("system") ?: ""
    val text = call.getString("text") ?: ""
    val image = call.getString("image")
    val history: JSArray = call.getArray("history") ?: JSArray()
    worker.execute {
      try {
        val eng = ensureEngine()
        try { conversation?.close() } catch (_: Throwable) {}
        val initial = mutableListOf<Message>()
        for (i in 0 until history.length()) {
          val m = history.getJSONObject(i)
          val t = m.optString("text")
          if (t.isBlank()) continue
          initial.add(if (m.optString("role") == "user") Message.user(t) else Message.model(t))
        }
        val conv = eng.createConversation(
          ConversationConfig(
            systemInstruction = if (system.isBlank()) null else Contents.of(system),
            initialMessages = initial,
            samplerConfig = SamplerConfig(topK = 40, topP = 0.95, temperature = 0.7),
          )
        )
        conversation = conv
        cancelled = false

        val parts = mutableListOf<Content>()
        if (!image.isNullOrEmpty()) parts.add(Content.ImageBytes(Base64.decode(image, Base64.DEFAULT)))
        parts.add(Content.Text(text.ifBlank { "Que vois-tu ?" }))

        val sb = StringBuilder()
        val done = CountDownLatch(1)
        var failure: Throwable? = null
        conv.sendMessageAsync(Contents.of(parts), object : MessageCallback {
          override fun onMessage(message: Message) {
            val chunk = message.contents.toString()
            if (chunk.isEmpty()) return
            sb.append(chunk)
            notifyListeners("token", JSObject().put("id", id).put("text", chunk))
          }
          override fun onDone() { done.countDown() }
          override fun onError(throwable: Throwable) { failure = throwable; done.countDown() }
        })
        done.await()
        val f = failure
        if (f != null && !cancelled) {
          call.reject(f.message ?: "Erreur de génération")
        } else {
          call.resolve(JSObject().put("text", sb.toString()).put("cancelled", cancelled).put("backend", backendName))
        }
      } catch (t: Throwable) {
        call.reject(t.message ?: "Erreur")
      }
    }
  }

  @PluginMethod
  fun cancel(call: PluginCall) {
    cancelled = true
    try { conversation?.cancelProcess() } catch (_: Throwable) {}
    call.resolve()
  }

  override fun handleOnDestroy() {
    worker.execute { closeAll() }
    super.handleOnDestroy()
  }
}
