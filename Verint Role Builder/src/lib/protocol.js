// Shared namespace + message-type constants. Loaded first in both the popup
// (script tags) and the content scripts (manifest order); plain globals, no
// ES modules, so the same files work in both worlds.
(function (root) {
  const VRB = (root.VRB = root.VRB || {});

  VRB.HOST = "mv311ver03d.corp.toronto.ca";
  VRB.MASTER_PATH = "data/privilege-config-list.csv";
  VRB.TEST_PREFIX = "ZZ_CLAUDE_TEST_";

  // popup -> background -> bridge.js (in the active Verint tab)
  VRB.MSG = {
    CHECK_PAGE: "CHECK_PAGE", // is the active tab on Roles Setup?
    GET_CONTEXT: "GET_CONTEXT", // owner org + existence/flags for a role
    APPLY: "APPLY", // open editor/create, strict-mirror, save, verify
    PROGRESS: "PROGRESS", // bridge -> popup streaming updates
  };
})(typeof self !== "undefined" ? self : this);
