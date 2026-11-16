package app.kairo.mobile

import android.content.Context
import android.os.PowerManager
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Packs hors ligne (cartes, routes, adresses) :
 * - download : télécharge les fichiers un par un, en reprenant après coupure (Wi-Fi ou 4G)
 * - read : lit un morceau d'un fichier (la carte lit ainsi ses tuiles à la demande)
 */
@CapacitorPlugin(name = "OfflinePack")
class OfflinePackPlugin : Plugin() {

  private val reader = Executors.newFixedThreadPool(3)
  @Volatile private var active: String? = null
  @Volatile private var stop = false
  @Volatile private var received = 0L
  @Volatile private var total = 0L
  @Volatile private var currentFile = ""
  @Volatile private var error = ""
  private var thread: Thread? = null

  private fun dir(id: String) = File(context.getExternalFilesDir(null) ?: context.filesDir, "packs/$id").apply { mkdirs() }
  private fun safe(name: String) = name.replace(Regex("[^A-Za-z0-9._-]"), "_")

  @PluginMethod
  fun status(call: PluginCall) {
    val id = call.getString("id") ?: return call.reject("id manquant")
    val out = JSObject()
    val files = JSObject()
    dir(id).listFiles()?.forEach { f -> if (f.isFile && !f.name.endsWith(".part")) files.put(f.name, f.length()) }
    out.put("files", files)
    out.put("downloading", active == id)
    out.put("received", received)
    out.put("total", total)
    out.put("current", currentFile)
    out.put("freeBytes", dir(id).usableSpace)
    if (error.isNotEmpty() && active == null) { out.put("error", error); error = "" }
    call.resolve(out)
  }

  /** files : [{name, url, size}] — total est la somme des tailles attendues. */
  @PluginMethod
  fun download(call: PluginCall) {
    val id = call.getString("id") ?: return call.reject("id manquant")
    val arr = call.getArray("files") ?: return call.reject("files manquant")
    if (active != null) return call.resolve(JSObject().put("state", "downloading"))
    data class F(val name: String, val url: String, val size: Long)
    val list = (0 until arr.length()).map { i ->
      val o = arr.getJSONObject(i)
      F(safe(o.getString("name")), o.getString("url"), o.optLong("size", 0L))
    }
    val d = dir(id)
    stop = false
    error = ""
    active = id
    total = list.sumOf { it.size }
    received = list.sumOf { f -> val done = File(d, f.name); if (done.exists()) done.length() else File(d, f.name + ".part").let { if (it.exists()) it.length() else 0L } }
    thread = Thread {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      val lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kairo:pack-download")
      lock.acquire(4 * 60 * 60 * 1000L)
      try {
        for (f in list) {
          val done = File(d, f.name)
          if (done.exists() && (f.size <= 0 || done.length() == f.size)) continue
          currentFile = f.name
          val part = File(d, f.name + ".part")
          var attempt = 0
          while (true) {
            try {
              fetch(f.url, part)
              break
            } catch (t: Throwable) {
              if (stop) throw t
              if (++attempt > 6) throw t
              Thread.sleep(3000L * attempt)
            }
          }
          if (f.size > 0 && part.length() != f.size) throw IllegalStateException("taille inattendue pour ${f.name}")
          done.delete()
          if (!part.renameTo(done)) throw IllegalStateException("impossible de finaliser ${f.name}")
        }
      } catch (t: Throwable) {
        if (!stop) error = "Téléchargement interrompu (${t.message ?: "réseau"}). Relance pour reprendre."
      } finally {
        active = null
        currentFile = ""
        if (lock.isHeld) lock.release()
      }
    }.apply { isDaemon = true; start() }
    call.resolve(JSObject().put("state", "downloading"))
  }

  private fun open(url: String, start: Long): HttpURLConnection {
    var u = URL(url)
    var hops = 0
    while (true) {
      val c = u.openConnection() as HttpURLConnection
      c.instanceFollowRedirects = false
      c.connectTimeout = 20000
      c.readTimeout = 60000
      c.setRequestProperty("User-Agent", "Kairo/1.0 (pack hors ligne; https://github.com/SAD3S/Kairo)")
      if (start > 0) c.setRequestProperty("Range", "bytes=$start-")
      val code = c.responseCode
      if (code in 300..399 && hops < 8) {
        val loc = c.getHeaderField("Location") ?: return c
        c.disconnect()
        u = URL(u, loc)
        hops++
        continue
      }
      return c
    }
  }

  private fun fetch(url: String, part: File) {
    val start = if (part.exists()) part.length() else 0L
    val conn = open(url, start)
    val code = conn.responseCode
    if (code == 416) return
    if (code !in 200..299) throw IllegalStateException("HTTP $code")
    val append = code == 206 && start > 0
    if (!append && start > 0) received -= start
    conn.inputStream.use { input ->
      FileOutputStream(part, append).use { out ->
        val buf = ByteArray(256 * 1024)
        while (true) {
          if (stop) throw InterruptedException("annulé")
          val n = input.read(buf)
          if (n < 0) break
          out.write(buf, 0, n)
          received += n
        }
      }
    }
    conn.disconnect()
  }

  @PluginMethod
  fun cancel(call: PluginCall) {
    stop = true
    thread?.join(3000)
    active = null
    call.resolve()
  }

  @PluginMethod
  fun remove(call: PluginCall) {
    val id = call.getString("id") ?: return call.reject("id manquant")
    stop = true
    thread?.join(3000)
    active = null
    dir(id).deleteRecursively()
    call.resolve()
  }

  /** Lit [offset, offset+length) d'un fichier du pack ; renvoie les octets en base64. */
  @PluginMethod
  fun read(call: PluginCall) {
    val id = call.getString("id") ?: return call.reject("id manquant")
    val name = safe(call.getString("name") ?: return call.reject("name manquant"))
    val offset = call.getLong("offset") ?: 0L
    val length = call.getInt("length") ?: 0
    reader.execute {
      try {
        val f = File(dir(id), name)
        RandomAccessFile(f, "r").use { raf ->
          val n = minOf(length.toLong(), maxOf(0L, raf.length() - offset)).toInt()
          val buf = ByteArray(n)
          raf.seek(offset)
          raf.readFully(buf)
          call.resolve(JSObject().put("data", Base64.encodeToString(buf, Base64.NO_WRAP)).put("size", raf.length()))
        }
      } catch (t: Throwable) {
        call.reject(t.message ?: "lecture impossible")
      }
    }
  }
}
