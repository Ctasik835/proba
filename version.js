/* Единый номер сборки. Меняется ЗДЕСЬ и только здесь:
   · index.html показывает его в штампе «сборка …» (app.js берёт window.APP_VERSION);
   · sw.js делает из него имя кэша оболочки ('ges-shell-' + APP_VERSION),
     что и заставляет браузер сбросить старые файлы.
   Раньше «v45» приходилось руками править в двух местах — версии разъезжались,
   и пользователи оставались на старом кэше. */
(function (g) {
  const APP_VERSION = 'v54';
  g.APP_VERSION = APP_VERSION;
  /* доступность из node — для tests/ и npm run version:check */
  if (typeof module === 'object' && module.exports) module.exports = { APP_VERSION };
})(typeof globalThis !== 'undefined' ? globalThis : self);
