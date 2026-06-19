<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const email = ref('')
const errorMessage = ref('')
const successMessage = ref('')

const handleReset = async () => {
  if (!email.value) {
    errorMessage.value = 'Please enter your email address.'
    return
  }

  errorMessage.value = ''
  successMessage.value = ''

  try {
    await authStore.forgotPassword(email.value)
    successMessage.value = 'If an account exists for that email, we have sent a password reset link.'
    email.value = ''
  } catch (err) {
    errorMessage.value = authStore.error || 'Failed to submit request. Please try again later.'
  }
}
</script>

<template>
  <div class="auth-container">
    <div class="auth-card fade-in-el">
      <div class="auth-header">
        <div class="auth-logo">Q</div>
        <h1 class="auth-title">Reset Password</h1>
        <p class="auth-subtitle">We will send you instructions to reset your password</p>
      </div>

      <!-- Alert States -->
      <div v-if="errorMessage" class="alert alert-error">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>{{ errorMessage }}</span>
      </div>

      <div v-if="successMessage" class="alert alert-success">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span>{{ successMessage }}</span>
      </div>

      <form v-if="!successMessage" @submit.prevent="handleReset">
        <div class="form-group">
          <label for="email" class="form-label">Email Address</label>
          <div class="input-wrapper">
            <input
              id="email"
              v-model="email"
              type="email"
              class="form-input"
              placeholder="you@example.com"
              required
              autocomplete="email"
            />
          </div>
        </div>

        <button type="submit" class="btn btn-primary" :disabled="authStore.loading">
          <span v-if="authStore.loading">Sending Instructions...</span>
          <span v-else>Send Reset Link</span>
        </button>
      </form>

      <div class="form-options" style="margin-top: 1.5rem; justify-content: center;">
        <router-link to="/login" class="auth-link">Back to Sign In</router-link>
      </div>
    </div>
  </div>
</template>
