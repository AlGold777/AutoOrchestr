/* Схематические позы (нормализованные координаты 0..1, начало слева сверху, Y вниз). */
(function () {
  var base = {
    head: [0.42, 0.18], neck: [0.42, 0.27],
    rightShoulder: [0.44, 0.30], rightElbow: [0.50, 0.40], rightWrist: [0.55, 0.32],
    leftShoulder: [0.40, 0.30], leftElbow: [0.37, 0.40], leftWrist: [0.40, 0.50],
    rightHip: [0.43, 0.55], leftHip: [0.40, 0.55],
    rightKnee: [0.47, 0.72], leftKnee: [0.38, 0.72],
    rightAnkle: [0.48, 0.90], leftAnkle: [0.36, 0.90]
  };
  function pose(o) { var r = {}, k; for (k in base) r[k] = base[k].slice(); for (k in o) r[k] = o[k]; return r; }
  window.POSES = {
    'late-preparation': pose({ rightElbow: [0.48, 0.42], rightWrist: [0.50, 0.53], leftWrist: [0.40, 0.55] }),
    'early-preparation': pose({ rightElbow: [0.47, 0.20], rightWrist: [0.51, 0.10], leftElbow: [0.46, 0.22], leftWrist: [0.54, 0.12] }),
    'low-contact': pose({ rightElbow: [0.50, 0.30], rightWrist: [0.54, 0.20] }),
    'high-contact': pose({ rightElbow: [0.47, 0.18], rightWrist: [0.49, 0.05] }),
    'leaning-back': pose({ head: [0.33, 0.19], neck: [0.36, 0.28], rightShoulder: [0.38, 0.31], leftShoulder: [0.34, 0.31],
      rightElbow: [0.42, 0.40], rightWrist: [0.48, 0.46], leftElbow: [0.31, 0.40], leftWrist: [0.33, 0.50],
      rightHip: [0.46, 0.56], leftHip: [0.43, 0.56] }),
    'balanced-finish': pose({ head: [0.46, 0.20], neck: [0.45, 0.28], rightShoulder: [0.47, 0.31], leftShoulder: [0.43, 0.31],
      rightElbow: [0.53, 0.40], rightWrist: [0.56, 0.48] }),
    'contact-behind': pose({ rightElbow: [0.42, 0.20], rightWrist: [0.40, 0.11] })
  };
  window.POSE_EDGES = [
    ['head', 'neck'], ['neck', 'rightShoulder'], ['neck', 'leftShoulder'],
    ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'], ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
    ['rightShoulder', 'rightHip'], ['leftShoulder', 'leftHip'], ['rightHip', 'leftHip'],
    ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'], ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle']
  ];
})();
