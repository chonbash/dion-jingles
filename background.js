// Background service worker для расширения

// Обработка установки расширения
chrome.runtime.onInstalled.addListener(() => {
  console.log('Dion Jingles установлен');
});

// Обработка обновления расширения
chrome.runtime.onUpdateAvailable.addListener(() => {
  console.log('Доступно обновление Dion Jingles');
});

