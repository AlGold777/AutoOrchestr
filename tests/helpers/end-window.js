// The End window of a Basic run stays open until its owner closes it (basic-windows.md «Окно End»). A test has no owner:
// it presses «Закрыть» as soon as a window appears, so the run ends the way it does for a person. Returns the disconnect.
function closeEndWindowsAsOwner(doc = document) {
  // A test that needs the window (to press Save, for example) sets doc.endWindowsStayOpen = true until it is done.
  const closeIn = (node) => {
    const dialog = node.matches?.('.basic-end-window') ? node : node.querySelector?.('.basic-end-window');
    if (doc.endWindowsStayOpen) return;
    dialog?.querySelector('.basic-end-close')?.click();
  };
  const observer = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(closeIn)));
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

module.exports = { closeEndWindowsAsOwner };
