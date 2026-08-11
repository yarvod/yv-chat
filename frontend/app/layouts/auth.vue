<template>
  <main class="auth-layout">
    <section class="auth-hero" aria-label="yv-chat">
      <div class="brand-lockup"><span class="brand-mark">Y</span><strong>yv-chat</strong></div>
      <div class="auth-hero__copy">
        <p class="eyebrow">Private by design</p>
        <h2>Общение<br><span>для своих.</span></h2>
        <p>Закрытый мессенджер для небольшой доверенной команды — без публичной регистрации и рекламных профилей.</p>
      </div>
      <div class="security-chip"><span>●</span> Private workspace</div>
    </section>
    <section class="auth-stage"><slot /></section>
  </main>
</template>
