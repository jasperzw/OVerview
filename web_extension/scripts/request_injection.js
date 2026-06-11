(function() {
  console.log("Started injection");

  const script = document.createElement("script");
  script.src = browser.runtime.getURL("script/xhr_inject.js");
  script.onload = function () {
    this.remove(); // clean up
  };
  (document.head || document.documentElement).appendChild(script);
})();
