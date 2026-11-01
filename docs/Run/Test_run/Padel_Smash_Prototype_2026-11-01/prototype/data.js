/* Заготовленные данные демо. Формат — раздел 5 проекта (proposal_final.md). */
window.DEMO_DATA = (function () {
  var fs = { athlete: { width: 1280, height: 720, rotation: 0 }, reference: { width: 1280, height: 720, rotation: 0 } };
  function ev(a, r, hl) {
    return { type: 'svg-preset', athletePose: a, referencePose: r,
      athleteFrameAsset: 'frames/' + a + '.svg', referenceFrameAsset: 'frames/' + r + '.svg', highlightJoints: hl };
  }
  function scenario(errors) {
    return { schemaVersion: '1.1', mode: 'mock', status: 'ready', analysisVersion: 'mock-1',
      coordinateSystem: 'normalized-top-left-y-down', frameSpec: fs, qualityWarnings: [], unassessablePhases: [], errors: errors };
  }
  return {
    schemaVersion: '1.1',
    exercise: { id: 'padel-smash-flat', name: 'Плоский смэш', shotType: 'remate_plano' },
    activeReferenceId: 'ref-001',
    references: [{
      id: 'ref-001', version: 1, status: 'active', videoId: 'coach-demo-001', role: 'coach', viewpoint: 'side',
      handedness: 'right', durationMs: 14000, source: 'demo',
      shots: [
        { index: 1, phasesMs: { preparation: 1300, contact: 2100, follow: 2500, recovery: 3200 } },
        { index: 2, phasesMs: { preparation: 7000, contact: 7800, follow: 8200, recovery: 8900 } }]
    }],
    attempts: [
      { id: 'attempt-001', videoId: 'athlete-demo-001', referenceId: 'ref-001', durationMs: 12000, shotCount: 2, source: 'demo', mockScenarioId: 'scenario-1' },
      { id: 'attempt-002', videoId: 'athlete-demo-002', referenceId: 'ref-001', durationMs: 11000, shotCount: 2, source: 'demo', mockScenarioId: 'scenario-2' }],
    mockScenarios: {
      'scenario-1': scenario([
        { id: 'err-001', code: 'SM01', shotIndex: 1, referenceShotIndex: 1, phase: 'preparation', athleteMs: 1600, referenceMs: 1300,
          evidence: ev('late-preparation', 'early-preparation', ['rightShoulder', 'rightElbow']) },
        { id: 'err-002', code: 'SM04', shotIndex: 1, referenceShotIndex: 1, phase: 'contact', athleteMs: 2400, referenceMs: 2100,
          evidence: ev('low-contact', 'high-contact', ['rightElbow', 'rightWrist']) },
        { id: 'err-003', code: 'SM06', shotIndex: 2, referenceShotIndex: 2, phase: 'follow', athleteMs: 8700, referenceMs: 8200,
          evidence: ev('leaning-back', 'balanced-finish', ['leftHip', 'rightHip']) }]),
      'scenario-2': scenario([
        { id: 'err-004', code: 'SM05', shotIndex: 2, referenceShotIndex: 2, phase: 'contact', athleteMs: 7500, referenceMs: 7800,
          evidence: ev('contact-behind', 'high-contact', ['rightShoulder', 'rightWrist']) }])
    },
    phaseNames: { preparation: 'Подготовка', contact: 'Контакт', follow: 'Сопровождение', recovery: 'Возврат' },
    catalog: [
      { code: 'SM01', title: 'Поздняя подготовка', sign: 'Ракетка поднимается прямо перед контактом', cause: 'Не хватает времени на согласованное движение', fix: 'Начинать подготовку сразу после распознавания высокого мяча', advice: 'Подними ракетку раньше — до того, как мяч начнёт падать', phase: 'preparation', viewpointLimited: false },
      { code: 'SM02', title: 'Недостаточный разворот корпуса', sign: 'Плечи почти не развёрнуты боком перед ударом', cause: 'Корпус не участвует в ударе', fix: 'Ранний боковой разворот плеч', advice: 'Разверни плечи боком ещё до замаха', phase: 'preparation', viewpointLimited: true,
        note: 'Это для базового плоского смэша. В игровых ситуациях допустима открытая стойка — решает тренер.' },
      { code: 'SM03', title: 'Пассивная свободная рука', sign: 'Нерабочая рука опущена вдоль тела', cause: 'Теряется ориентир на мяч', fix: 'Поднять свободную руку к мячу', advice: 'Направь свободную руку к мячу при подготовке', phase: 'preparation', viewpointLimited: false },
      { code: 'SM04', title: 'Низкая точка контакта', sign: 'Локоть согнут, мяч встречен ниже верхней точки', cause: 'Снижается высота контакта', fix: 'Раньше занять позицию, вытянуть ударную руку', advice: 'Встречай мяч выше, с вытянутой рукой', phase: 'contact', viewpointLimited: false },
      { code: 'SM05', title: 'Контакт за корпусом', sign: 'Мяч встречен позади линии ударного плеча', cause: 'Игрок не успел встать под мяч', fix: 'Раньше сместиться под траекторию мяча', advice: 'Займи позицию так, чтобы мяч был чуть впереди', phase: 'contact', viewpointLimited: true },
      { code: 'SM06', title: 'Потеря баланса', sign: 'После удара корпус отклоняется назад', cause: 'Нарушен перенос веса', fix: 'Стабилизировать опору, вести движение вперёд', advice: 'Сохраняй баланс, выходи из удара вперёд', phase: 'follow', viewpointLimited: true },
      { code: 'SM07', title: 'Оборванное сопровождение', sign: 'Ракетка останавливается сразу после контакта', cause: 'Движение прервано', fix: 'Продолжить траекторию ракетки через корпус', advice: 'Не обрывай удар сразу после контакта', phase: 'follow', viewpointLimited: false },
      { code: 'SM08', title: 'Нет восстановления позиции', sign: 'Игрок стоит после удара', cause: 'Задерживается готовность к следующему мячу', fix: 'Встать в игровую стойку', advice: 'После смэша сразу готовься к следующему удару', phase: 'recovery', viewpointLimited: false }
    ]
  };
})();
