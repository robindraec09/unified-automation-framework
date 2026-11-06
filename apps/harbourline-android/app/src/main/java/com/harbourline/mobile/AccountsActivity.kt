package com.harbourline.mobile

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.concurrent.thread

class AccountsActivity : Activity() {
    private lateinit var list: LinearLayout
    private lateinit var net: TextView
    private lateinit var error: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Session.accessToken == null) return backToLogin()
        setContentView(R.layout.activity_accounts)
        list = findViewById(R.id.account_list)
        net = findViewById(R.id.net_position)
        error = findViewById(R.id.accounts_error)
        findViewById<TextView>(R.id.customer_name).text = Session.customerName
        findViewById<Button>(R.id.logout_button).setOnClickListener {
            Session.clear()
            backToLogin()
        }
        findViewById<Button>(R.id.transfer_button).setOnClickListener {
            startActivity(Intent(this, TransferActivity::class.java))
        }
    }

    // Reload on every visit so balances are current after a transfer
    override fun onResume() {
        super.onResume()
        if (Session.accessToken == null) return
        thread {
            val result = runCatching { BankApi.accounts() }
            runOnUiThread { result.onSuccess(::render).onFailure { showError(it.message ?: "Error") } }
        }
    }

    private fun render(accounts: List<Account>) {
        error.visibility = View.GONE
        list.removeAllViews()
        for (a in accounts) {
            val row = layoutInflater.inflate(R.layout.item_account, list, false)
            row.findViewById<TextView>(R.id.account_name).text = a.name
            row.findViewById<TextView>(R.id.account_balance).text = aud(a.balance)
            row.findViewById<TextView>(R.id.account_meta).text =
                "BSB 999-001  Acc ${a.accountNumber}  ·  Available ${aud(a.available)}"
            row.contentDescription = "${a.name}, account ${a.accountNumber}, balance ${aud(a.balance)}"
            list.addView(row)
        }
        net.text = aud(accounts.sumOf { Math.round(it.balance * 100) } / 100.0)
    }

    private fun showError(message: String) {
        error.text = message
        error.visibility = View.VISIBLE
    }

    private fun backToLogin() {
        startActivity(Intent(this, LoginActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
        finish()
    }
}
