(()=>{var e="https://justiceo.github.io/xtension/uninstall.html",n="https://justiceo.github.io/xtension/uninstall.html",r=t=>{t.reason==="install"&&chrome.tabs.create({url:n,active:!0}),chrome.runtime.setUninstallURL(e,()=>{chrome.runtime.lastError&&console.error("Error setting uninstall URL",chrome.runtime.lastError)})};chrome.runtime.onInstalled.addListener(r);})();
