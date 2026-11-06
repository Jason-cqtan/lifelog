// Night sky for dark mode, shared by mdyrbz.com's pages (the homepage has its own,
// with weather): twinkling stars and the odd meteor in a fixed layer behind the
// content. It shows only while <html data-theme="dark">, so the page's own theme
// toggle switches it with no script here.
//
//   lifelog: web/index.html          blog: internal/blog/site.html (as /lifelog/sky.js)
;(function () {
  if (document.getElementById('night-sky')) return
  var css =
    '#night-sky{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;opacity:0;transition:opacity 1.2s ease}' +
    ':root[data-theme="dark"] #night-sky{opacity:1}' +
    '#night-sky i{position:absolute;border-radius:50%;background:#fff;animation:ns-twinkle 3s ease-in-out infinite}' +
    '#night-sky i.big{box-shadow:0 0 6px 1px rgba(200,215,255,.7)}' +
    '@keyframes ns-twinkle{0%,100%{opacity:.12;transform:scale(.7)}50%{opacity:.75;transform:scale(1.1)}}' +
    '#night-sky b{position:absolute;height:2px;border-radius:2px;opacity:0;transform:rotate(-28deg);transform-origin:left center;' +
    'background:linear-gradient(90deg,#fff,rgba(200,215,255,.55) 30%,transparent);filter:drop-shadow(0 0 4px rgba(200,220,255,.8));' +
    'animation:ns-shoot 11s cubic-bezier(.3,.1,.6,1) infinite}' +
    '@keyframes ns-shoot{0%,88%{opacity:0;translate:0 0}89%{opacity:.9}96%{opacity:.7}100%{opacity:0;translate:-420px 220px}}' +
    '@media (prefers-reduced-motion:reduce){#night-sky i,#night-sky b{animation:none}#night-sky b{display:none}}'
  var style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  var sky = document.createElement('div')
  sky.id = 'night-sky'
  sky.setAttribute('aria-hidden', 'true')
  var html = ''
  for (var k = 0; k < 130; k++) {
    var big = Math.random() < 0.1
    var size = big ? 2 + Math.random() : 0.7 + Math.random() * 1.1
    html +=
      '<i class="' + (big ? 'big' : '') + '" style="left:' + (Math.random() * 100).toFixed(2) + '%;top:' +
      (Math.random() * 100).toFixed(2) + '%;width:' + size.toFixed(1) + 'px;height:' + size.toFixed(1) +
      'px;animation-duration:' + (2 + Math.random() * 4).toFixed(2) + 's;animation-delay:' + (-Math.random() * 6).toFixed(2) + 's"></i>'
  }
  // three meteors on their own clocks
  var meteors = [
    ['8%', '74%', 150, 11, 3],
    ['20%', '90%', 110, 15, 8],
    ['4%', '48%', 130, 19, 13],
  ]
  for (var m = 0; m < meteors.length; m++) {
    var x = meteors[m]
    html += '<b style="top:' + x[0] + ';left:' + x[1] + ';width:' + x[2] + 'px;animation-duration:' + x[3] + 's;animation-delay:' + x[4] + 's"></b>'
  }
  sky.innerHTML = html
  var add = function () { document.body.insertBefore(sky, document.body.firstChild) }
  if (document.body) add()
  else document.addEventListener('DOMContentLoaded', add)
})()
