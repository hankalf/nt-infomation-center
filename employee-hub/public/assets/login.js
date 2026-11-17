(function () {
  var q = new URLSearchParams(location.search);
  var messages = {
    wrong: "That password isn't right. Please try again.",
    locked: "Too many attempts. Please wait 15 minutes and try again.",
    disabled: "The admin area is turned off because ADMIN_PASSWORD isn't set on the service. Add it in Railway → Variables and redeploy.",
  };
  var code = q.get("error");
  if (code && messages[code]) {
    var el = document.getElementById("error");
    el.textContent = messages[code];
    el.hidden = false;
  }
  if (q.get("signedout")) {
    var n = document.getElementById("notice");
    n.textContent = "You've been signed out.";
    n.hidden = false;
  }
})();
