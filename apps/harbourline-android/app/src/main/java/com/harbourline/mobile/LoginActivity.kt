package com.harbourline.mobile

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import kotlin.concurrent.thread

class LoginActivity : Activity() {
    private lateinit var customerId: EditText
    private lateinit var password: EditText
    private lateinit var error: TextView
    private lateinit var submit: Button
    private lateinit var progress: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)
        customerId = findViewById(R.id.customer_id)
        password = findViewById(R.id.password)
        error = findViewById(R.id.login_error)
        submit = findViewById(R.id.login_button)
        progress = findViewById(R.id.login_progress)
        submit.setOnClickListener { attempt() }
    }

    private fun attempt() {
        val id = customerId.text.toString().trim()
        val pw = password.text.toString()
        if (id.isEmpty() || pw.isEmpty()) return showError(getString(R.string.error_required))

        busy(true)
        thread {
            val failure = runCatching { BankApi.signIn(id, pw) }.exceptionOrNull()
            runOnUiThread {
                busy(false)
                when {
                    failure == null -> {
                        startActivity(Intent(this, AccountsActivity::class.java))
                        finish()
                    }
                    failure is ApiException && failure.status == 423 -> showError(getString(R.string.error_locked))
                    failure is ApiException -> showError(getString(R.string.error_credentials))
                    else -> showError(getString(R.string.error_network))
                }
            }
        }
    }

    private fun busy(on: Boolean) {
        submit.isEnabled = !on
        progress.visibility = if (on) View.VISIBLE else View.GONE
        if (on) error.visibility = View.GONE
    }

    private fun showError(message: String) {
        error.text = message
        error.visibility = View.VISIBLE
    }
}
