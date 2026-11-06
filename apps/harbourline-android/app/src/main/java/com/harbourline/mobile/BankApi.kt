package com.harbourline.mobile

import android.net.Uri
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.text.NumberFormat
import java.util.Locale
import java.util.UUID

data class Account(val id: Int, val name: String, val type: String, val accountNumber: String, val balance: Double, val available: Double)

/** An error the server explained: HTTP status + its `{ error, message }` body. */
class ApiException(val status: Int, val code: String, override val message: String) : Exception(message)

/** Formats like the web UI: en-AU dollars, e.g. $1,000.00 */
fun aud(amount: Double): String = NumberFormat.getCurrencyInstance(Locale("en", "AU")).format(amount)

/** Signed-in state for this process. Tokens never touch disk. */
object Session {
    var accessToken: String? = null
    var customerName: String = ""
    fun clear() {
        accessToken = null
        customerName = ""
    }
}

/**
 * Harbourline Bank API client: platform HTTP + org.json only.
 * Call from a background thread.
 */
object BankApi {
    private val base = BuildConfig.BANK_URL
    private const val CLIENT_ID = "harbour-mobile"
    private const val REDIRECT_URI = "com.harbourline.mobile://oauth/callback"
    private const val SCOPE = "accounts:read transactions:read payees:read payments:write"

    /**
     * OAuth 2.0 authorization code + PKCE (S256) as a public client: submit the sign-in form to
     * /oauth/authorize without following the redirect, take the code from the Location header,
     * then exchange it with the verifier. No client secret ships in the app.
     */
    fun signIn(customerId: String, password: String) {
        val verifier = randomUrlSafe(32)
        val challenge = base64Url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
        val state = randomUrlSafe(12)

        val authorize = open("/oauth/authorize", "POST").apply { instanceFollowRedirects = false }
        writeForm(authorize, mapOf(
            "response_type" to "code", "client_id" to CLIENT_ID, "redirect_uri" to REDIRECT_URI,
            "scope" to SCOPE, "state" to state, "code_challenge" to challenge,
            "code_challenge_method" to "S256", "username" to customerId, "password" to password,
            "decision" to "allow",
        ))
        val status = authorize.responseCode
        if (status == 423) throw ApiException(423, "account_locked", "locked")
        if (status != 302) throw ApiException(status, "invalid_credentials", "credentials")
        val location = Uri.parse(authorize.getHeaderField("Location") ?: "")
        if (location.getQueryParameter("state") != state) throw IOException("OAuth state mismatch")
        val code = location.getQueryParameter("code") ?: throw IOException("No authorization code")

        val token = open("/oauth/token", "POST")
        writeForm(token, mapOf(
            "grant_type" to "authorization_code", "client_id" to CLIENT_ID, "code" to code,
            "redirect_uri" to REDIRECT_URI, "code_verifier" to verifier,
        ))
        Session.accessToken = JSONObject(readBody(token)).getString("access_token")
        Session.customerName = JSONObject(get("/api/v1/me")).getString("fullName")
    }

    fun accounts(): List<Account> {
        val arr = JSONArray(get("/api/v1/accounts"))
        return (0 until arr.length()).map { i ->
            val a = arr.getJSONObject(i)
            Account(a.getInt("id"), a.getString("name"), a.getString("type"), a.getString("accountNumber"),
                a.getDouble("balance"), a.getDouble("availableBalance"))
        }
    }

    /** Returns the transfer id (the receipt number). */
    fun transfer(fromId: Int, toId: Int, amount: Double, description: String, idempotencyKey: String): String {
        val c = open("/api/v1/transfers", "POST", authed = true)
        c.setRequestProperty("Content-Type", "application/json")
        c.setRequestProperty("Idempotency-Key", idempotencyKey)
        val body = JSONObject().put("fromAccountId", fromId).put("toAccountId", toId)
            .put("amount", amount).put("description", description)
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        return JSONObject(readBody(c)).getString("id")
    }

    fun newIdempotencyKey(): String = UUID.randomUUID().toString()

    // ---- plumbing ----

    private fun get(path: String): String = readBody(open(path, "GET", authed = true))

    private fun open(path: String, method: String, authed: Boolean = false): HttpURLConnection =
        (URL(base + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 15_000
            setRequestProperty("Accept", "application/json")
            if (authed) setRequestProperty("Authorization", "Bearer ${Session.accessToken}")
            if (method == "POST") doOutput = true
        }

    private fun writeForm(c: HttpURLConnection, fields: Map<String, String>) {
        c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        val body = fields.entries.joinToString("&") { (k, v) -> "${enc(k)}=${enc(v)}" }
        c.outputStream.use { it.write(body.toByteArray()) }
    }

    private fun readBody(c: HttpURLConnection): String {
        val status = c.responseCode
        val stream = if (status in 200..299) c.inputStream else c.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
        if (status !in 200..299) {
            val json = runCatching { JSONObject(text) }.getOrNull()
            throw ApiException(status, json?.optString("error") ?: "http_$status",
                json?.optString("message")?.takeIf { it.isNotBlank() } ?: "Request failed ($status)")
        }
        return text
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun base64Url(bytes: ByteArray) =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    private fun randomUrlSafe(n: Int) = base64Url(ByteArray(n).also { SecureRandom().nextBytes(it) })
}
