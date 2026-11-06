package com.harbourline.mobile

import android.app.Activity
import android.os.Bundle
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import kotlin.concurrent.thread

class TransferActivity : Activity() {
    private var accounts: List<Account> = emptyList()
    private lateinit var from: Spinner
    private lateinit var to: Spinner
    private lateinit var amount: EditText
    private lateinit var description: EditText
    private lateinit var error: TextView
    private lateinit var submit: Button

    // One key per form view: tapping Transfer twice can never pay twice
    private var idempotencyKey = BankApi.newIdempotencyKey()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_transfer)
        from = findViewById(R.id.from_spinner)
        to = findViewById(R.id.to_spinner)
        amount = findViewById(R.id.amount)
        description = findViewById(R.id.description)
        error = findViewById(R.id.transfer_error)
        submit = findViewById(R.id.transfer_submit)
        submit.isEnabled = false
        submit.setOnClickListener { attempt() }
        findViewById<Button>(R.id.back_to_accounts).setOnClickListener { finish() }

        thread {
            val result = runCatching { BankApi.accounts() }
            runOnUiThread {
                result.onSuccess { list ->
                    accounts = list
                    val labels = list.map { "${it.name} (${it.accountNumber}) ${aud(it.available)}" }
                    from.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
                    to.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
                    if (list.size > 1) to.setSelection(1)
                    submit.isEnabled = true
                }.onFailure { showError(it.message ?: "Error") }
            }
        }
    }

    private fun attempt() {
        error.visibility = View.GONE
        val text = amount.text.toString().trim().replace(",", "")
        if (!Regex("^\\d+(\\.\\d{1,2})?$").matches(text) || text.toDouble() <= 0.0)
            return showError(getString(R.string.error_amount))
        val src = accounts[from.selectedItemPosition]
        val dst = accounts[to.selectedItemPosition]
        val value = text.toDouble()

        submit.isEnabled = false
        thread {
            val result = runCatching {
                BankApi.transfer(src.id, dst.id, value, description.text.toString().trim(), idempotencyKey)
            }
            runOnUiThread {
                submit.isEnabled = true
                result.onSuccess { id ->
                    findViewById<View>(R.id.transfer_form).visibility = View.GONE
                    findViewById<TextView>(R.id.receipt_summary).text = "${aud(value)} sent to ${dst.name}"
                    findViewById<TextView>(R.id.receipt_id).text = id
                    findViewById<View>(R.id.transfer_receipt).visibility = View.VISIBLE
                    idempotencyKey = BankApi.newIdempotencyKey()
                }.onFailure { showError(it.message ?: "Error") }
            }
        }
    }

    private fun showError(message: String) {
        error.text = message
        error.visibility = View.VISIBLE
    }
}
