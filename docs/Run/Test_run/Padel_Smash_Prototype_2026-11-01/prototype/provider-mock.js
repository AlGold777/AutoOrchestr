/* Провайдер анализа. Контракт:
   analyze({attemptId, referenceId, videoBlob, mockScenarioId?, simulateFail?}, onProgress) -> Promise<AnalysisResult>
   Настоящий PoseAnalysisProvider реализует тот же контракт; выбор — одна строка ниже. */
window.MockAnalysisProvider = {
  name: 'mock',
  analyze: function (req, onProgress) {
    var steps = ['Подготовка кадров', 'Сопоставление фаз с эталоном', 'Подготовка разбора'];
    return new Promise(function (resolve, reject) {
      var i = 0;
      (function next() {
        if (i >= steps.length) {
          var sc = window.DEMO_DATA.mockScenarios[req.mockScenarioId];
          if (!sc) return reject(new Error('Нет демо-сценария ' + req.mockScenarioId));
          onProgress && onProgress(1, 'Готово');
          return resolve(JSON.parse(JSON.stringify(sc)));
        }
        onProgress && onProgress(i / steps.length, steps[i]);
        if (req.simulateFail && i === 1) return setTimeout(function () { reject(new Error('Демо-сбой анализа')); }, 900);
        i++;
        setTimeout(next, 1000);
      })();
    });
  }
};
window.ANALYSIS_PROVIDER = window.MockAnalysisProvider;
