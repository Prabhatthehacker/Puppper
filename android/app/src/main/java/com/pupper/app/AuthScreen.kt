package com.pupper.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Pupper's mascot: the golden retriever puppy logo (res/drawable-nodpi/pupper_logo.png). */
@Composable
fun BrandMark(size: androidx.compose.ui.unit.Dp = 72.dp) {
    androidx.compose.foundation.Image(
        painter = androidx.compose.ui.res.painterResource(R.drawable.pupper_logo),
        contentDescription = "Pupper, a golden retriever puppy",
        modifier = Modifier.size(size),
    )
}

@Composable
fun AuthScreen() {
    var mode by remember { mutableStateOf("in") }
    var name by remember { mutableStateOf("") }; var email by remember { mutableStateOf("") }; var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }; var info by remember { mutableStateOf<String?>(null) }; var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun submit() {
        error = null; info = null; busy = true
        scope.launch {
            try {
                when (mode) {
                    "up" -> Repo.register(name, email, password)
                    "in" -> Repo.login(email, password)
                    else -> { Repo.resetPassword(email); info = "If an account exists for this email, a reset link is on its way." }
                }
            } catch (e: Exception) { error = Repo.authMessage(e) } finally { busy = false }
        }
    }

    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(28.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        BrandMark(80.dp)
        Text("Pupper", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = Palette.BrownDeep, modifier = Modifier.padding(top = 12.dp))
        Text(if (mode == "reset") "Enter your email and we will send a reset link." else "Connect with the people who matter.",
            color = Palette.Muted, modifier = Modifier.padding(top = 4.dp, bottom = 20.dp))
        if (mode == "up") OutlinedTextField(name, { name = it.take(60) }, label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        if (mode != "reset") OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        error?.let { Text(it, color = Palette.Danger, modifier = Modifier.padding(top = 10.dp)) }
        info?.let { Text(it, color = Palette.BrownDeep, modifier = Modifier.padding(top = 10.dp)) }
        PrimaryButton(if (busy) "Please wait…" else when (mode) { "in" -> "Sign in"; "up" -> "Create account"; else -> "Send reset link" },
            enabled = !busy && email.isNotBlank(), modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) { submit() }
        if (mode == "in") OutlinedButton({ mode = "up"; error = null }, Modifier.fillMaxWidth().padding(top = 8.dp)) { Text("Create account") }
        if (mode == "in") TextButton({ mode = "reset"; error = null }) { Text("Forgot password?") }
        else TextButton({ mode = "in"; error = null; info = null }) { Text("Back to sign in") }
    }
}

@Composable
fun SetupNeeded() {
    Column(Modifier.fillMaxSize().padding(28.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        BrandMark(80.dp)
        Text("Almost there", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
        Text("This build has no Firebase settings. Add them to android/local.properties (see README) and rebuild.", color = Palette.Muted, modifier = Modifier.padding(top = 8.dp))
    }
}
