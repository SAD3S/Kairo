package app.kairo.mobile

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
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
    if (state != "ready" && id >= 0) {
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
            DownloadManager.STATUS_PAUSED -> state = "paused"
            else -> state = "downloading"
          }
        } else {
          prefs().edit().remove("downloadId").apply()
        }
      }
    }
    out.put("state", state)
    out.put("received", received)
    out.put("total", total)
    out.put("size", if (file.exists()) file.length() else 0L)
    out.put("loaded", engine != null)
    out.put("backend", backendName)
    out.put("freeBytes", modelDir().usableSpace)
    if (error.isNotEmpty()) out.put("error", error)
    call.resolve(out)
  }

  @PluginMethod
  fun download(call: PluginCall) {
    if (modelFile().exists()) { call.resolve(JSObject().put("state", "ready")); return }
    if (prefs().getLong("downloadId", -1L) >= 0) { call.resolve(JSObject().put("state", "downloading")); return }
    partFile().delete()
    val req = DownloadManager.Request(Uri.parse(call.getString("url") ?: MODEL_URL))
      .setTitle("Kairo · modèle d’IA")
      .setDescription("Gemma 4 E2B (2,6 Go)")
      .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
      .setAllowedOverMetered(call.getBoolean("allowMobileData", false) ?: false)
      .setAllowedOverRoaming(false)
      .setDestinationUri(Uri.fromFile(partFile()))
    val id = dm().enqueue(req)
    prefs().edit().putLong("downloadId", id).apply()
    call.resolve(JSObject().put("state", "downloading"))
  }

  @PluginMethod
  fun cancelDownload(call: PluginCall) {
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
