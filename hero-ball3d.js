/* 3D SPORTS BALLS: a basketball, volleyball, tennis ball and shuttlecock.
   Home: piled together in the hero (#heroBall3d), they are thrown in from the left and right edges of the hero.
   Login / Register: they are thrown in from the left and right and settle beside the form card.
   Hover one and it spins with your mouse. Click it and it bounces.
   Plain WebGL2 (no library, nothing to download). If WebGL2 is not available the ball is simply removed.
   To remove: delete this file, the #heroBall3d block in index.html and the <script> lines. */
(function () {
    'use strict';

    var box = document.getElementById('heroBall3d'), page = null, AUTH = false;
    if (!box) {
        page = document.querySelector('body:is(#loginPage, #registerPage) .auth-page');
        if (!page || !page.querySelector('.auth-card')) return;
        AUTH = true;
        box = document.createElement('div');
        box.className = 'auth-balls';
        box.setAttribute('aria-hidden', 'true');
        box.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;';
        box.appendChild(document.createElement('canvas'));
        box.firstChild.style.cssText = 'display:block;width:100%;height:100%;';
        if (getComputedStyle(page).position === 'static') page.style.position = 'relative';
        page.insertBefore(box, page.firstChild);
        [].forEach.call(page.children, function (el) {
            if (el !== box && !el.classList.contains('hero-lines') && getComputedStyle(el).position === 'static') { el.style.position = 'relative'; el.style.zIndex = '1'; }
        });
    }
    var canvas = box.querySelector('canvas');
    var gl = canvas && canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) { box.parentNode.removeChild(box); return; }

    /* Home: the canvas becomes a layer over the whole hero so the balls can fly in from its edges.
       #heroBall3d stays where it is and only marks where the balls end up. */
    var host = null, layer = null;
    if (!AUTH) {
        host = box.closest('.hero');
        if (host) {
            layer = document.createElement('div');
            layer.className = 'hero-balls-layer';
            layer.setAttribute('aria-hidden', 'true');
            layer.style.cssText = 'position:absolute;inset:0;z-index:3;pointer-events:none;';
            canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none;';
            canvas.removeAttribute('tabindex');
            canvas.removeAttribute('aria-label');
            layer.appendChild(canvas);
            host.appendChild(layer);
            box.style.cursor = 'inherit';                  // the hero shows the pointer only over a ball
            box.setAttribute('tabindex', '0');
            box.setAttribute('role', 'img');
            box.setAttribute('aria-label', '3D basketball, volleyball, tennis ball and shuttlecock. Hover one to spin it, click to bounce.');
            var st = document.createElement('style');
            st.textContent = '.hero-ball3d:focus-visible{outline:2px solid var(--amber,#eaa63a);outline-offset:4px}';
            document.head.appendChild(st);
        }
    }

    /* ------------------------------------------------------------------ shaders */
    var VS = '#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    var FS = [
        '#version 300 es',
        'precision highp float;',
        'uniform vec2 uRes;uniform vec3 uC;uniform vec3 uS;uniform mat3 uRinv;uniform float uGy;uniform vec2 uShadow;uniform float uType;uniform float uPass;uniform vec2 uOff;uniform float uTan;',
        'out vec4 o;',
        'vec3 h33(vec3 p){p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));return fract(sin(p)*43758.5453);}',
        /* nearest dimple: x = distance, yzw = direction to its centre */
        'vec4 pebble(vec3 q){vec3 i=floor(q),f=fract(q);float md=9.;vec3 mv=vec3(0);',
        ' for(int z=-1;z<=1;z++)for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec3 g=vec3(float(x),float(y),float(z));vec3 r=g+h33(i+g)-f;float d=dot(r,r);if(d<md){md=d;mv=r;}}',
        ' return vec4(sqrt(md),mv);}',
        'float seam(vec3 q,vec3 n,float c,float w,out float groove){float d=abs(dot(q,n)-c)/sqrt(1.-c*c);float aa=fwidth(d)*.9+1e-4;groove=1.-smoothstep(w,w*3.4,d);return 1.-smoothstep(w-aa,w+aa,d);}',
        /* tennis ball seam: distance to the classic two-lobe curve */
        'vec3 tp(float t){return normalize(vec3(cos(t)+.28*cos(3.*t),sin(t)-.28*sin(3.*t),1.058*sin(2.*t)));}',
        'float tennisD(vec3 q){float md=9.;vec3 pp=tp(0.);for(int i=1;i<=72;i++){vec3 pc=tp(float(i)*.0872665);vec3 e=pc-pp;float h=clamp(dot(q-pp,e)/dot(e,e),0.,1.);md=min(md,length(q-pp-e*h));pp=pc;}return md;}',
        /* shuttlecock, axis along y: cork head, feather skirt, rim tape, thread */
        'float prof(float y){float f=clamp((y+.28)/1.1,0.,1.);return .19+.41*pow(f,.9);}',
        'float sdHead(vec3 p){return length(p*vec3(1.,1.08,1.)-vec3(0.,-.54,0.))-.27;}',
        'float sdSkirt(vec3 p){float r=length(p.xz);float th=atan(p.z,p.x);float R=prof(p.y)+.010*cos(th*16.);float s=abs(r-R)-.011;return max(s,max(p.y-.82,-.28-p.y));}',
        'float sdRim(vec3 p){float r=length(p.xz);return length(vec2(r-prof(.82),p.y-.82))-.024;}',
        'float sdThr(vec3 p){float r=length(p.xz);return length(vec2(r-prof(.2)-.004,p.y-.2))-.014;}',
        'float sdShuttle(vec3 p){return min(min(sdHead(p),sdSkirt(p)),min(sdRim(p),sdThr(p)));}',
        'void main(){',
        ' vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.-uOff;',
        ' vec3 ro=vec3(0.,0.,7.);vec3 rd=normalize(vec3(uv.x*uRes.x/uRes.y*uTan,uv.y*uTan,-1.));',
        ' vec4 sh=vec4(0.);',
        ' if(uPass>.5){if(rd.y<-1e-4){float tg=(uGy-ro.y)/rd.y;vec3 g=ro+rd*tg;vec2 gg=g.xz-uC.xz;float d=dot(gg,gg)/(uShadow.x*uShadow.x);sh=vec4(0.,0.,0.,exp(-d*2.3)*uShadow.y);}o=sh;return;}',
        ' vec3 oc=(ro-uC)/uS;vec3 dd=rd/uS;',
        ' float cover=0.;vec3 nW=vec3(0.,1.,0.),q=vec3(0.,0.,1.),n=nW,base=vec3(.8);',
        ' float line=0.,dimple=0.,spec=.2,specPow=22.,rimAmt=.5;vec3 rimCol=vec3(1.,.55,.22);',
        ' vec3 V=-rd;',
        ' if(uType<2.5){',
        '  float a=dot(dd,dd),b=dot(oc,dd),c=dot(oc,oc)-1.;float disc=b*b-a*c;',
        '  float fw=fwidth(disc)+1e-6;cover=clamp(disc/fw*.5+.5,0.,1.);',
        '  if(cover<=0.){o=vec4(0.);return;}',
        '  float t=(-b-sqrt(max(disc,0.)))/a;vec3 p=normalize(oc+dd*t);',
        '  nW=normalize(p/uS);n=nW;',
        '  q=normalize(uRinv*p);',
        '  if(uType<.5){',
        /* basketball: equator + centre line + two side curves */
        '   float gA,gB,gz0,gz1;float w=.026;',
        '   float sA=seam(q,vec3(0.,1.,0.),0.,w,gA);',
        '   float sB=seam(q,vec3(1.,0.,0.),0.,w,gB);',
        '   float s0=seam(q,normalize(vec3(1.,0.,.35)),.55,w,gz0);',
        '   float s1=seam(q,normalize(vec3(-1.,0.,.35)),.55,w,gz1);',
        '   line=max(max(max(sA,sB),s0),s1);',
        '   float groove=max(max(max(gA,gB),gz0),gz1);',
        '   vec4 pb=pebble(q*30.);',
        '   dimple=smoothstep(.62,.05,pb.x)*(1.-groove);',
        '   vec3 toC=pb.yzw*uRinv;',
        '   n=normalize(nW-toC*.55*(1.-groove)*smoothstep(.0,.6,pb.x)*.6);',
        '   base=vec3(.90,.37,.10);base*=1.-.16*dimple;',
        '   base=mix(base,vec3(.82,.30,.07),smoothstep(-.6,.9,q.y)*.25);',
        '   base*=1.-.38*groove;base=mix(base,vec3(.06,.03,.02),line);',
        '   spec=.10+.12*dimple;specPow=22.;',
        '  }else if(uType<1.5){',
        /* volleyball: three interlocking belts (white / yellow / blue) with stitched seams */
        '   vec3 A=normalize(vec3(1.,.28,.12)),B=normalize(vec3(-.28,1.,.1)),C=normalize(cross(A,B));',
        '   float ca=dot(q,A),cb=dot(q,B),cc=dot(q,C);',
        '   float aa=fwidth(cb)*1.2+1e-4;',
        '   float bB=1.-smoothstep(.40-aa,.40+aa,abs(cb));',
        '   float bA=1.-smoothstep(.40-aa,.40+aa,abs(ca));',
        '   base=vec3(.97,.94,.86);base=mix(base,vec3(.98,.78,.16),bA);base=mix(base,vec3(.13,.34,.70),bB);',
        '   float eB=1.-smoothstep(.006,.006+aa,abs(abs(cb)-.40));',
        '   float eA=1.-smoothstep(.006,.006+aa,abs(abs(ca)-.40));',
        '   float iB=1.-smoothstep(.003,.003+aa*.8,abs(abs(cb)-.14));',
        '   float iA=1.-smoothstep(.003,.003+aa*.8,abs(abs(ca)-.14));',
        '   line=max(max(eA,eB),max(iA,iB)*.38);',
        '   base=mix(base,base*.25,line);',
        '   base*=.97+.03*h33(floor(q*160.)).x;',
        '   spec=.34;specPow=34.;rimAmt=.25;rimCol=vec3(.75,.85,1.);',
        '  }else{',
        /* tennis ball: fuzzy optic yellow with the white curved seam */
        '   float d=tennisD(q);float aa=fwidth(d)*1.1+1e-4;',
        '   float sm=1.-smoothstep(.040-aa,.040+aa,d);',
        '   float gr=1.-smoothstep(.04,.11,d);',
        '   vec3 f3=h33(floor(q*110.));',
        '   base=vec3(.80,.90,.17);base*=.88+.24*f3.x;',
        '   base*=1.-.25*gr*(1.-sm);',
        '   base=mix(base,vec3(.96,.96,.90)*(.9+.1*f3.y),sm);',
        '   vec3 jit=(h33(floor(q*70.))-.5)*.16;n=normalize(nW+jit);',
        '   line=0.;spec=.03;specPow=8.;rimAmt=.75;rimCol=vec3(.85,1.,.35);',
        '  }',
        ' }else{',
        /* shuttlecock: ray-march in its own space */
        '  vec3 oL=uRinv*oc;vec3 dL=normalize(uRinv*dd);',
        '  float bb=dot(oL,dL),cc2=dot(oL,oL)-1.44,dsc=bb*bb-cc2;',
        '  if(dsc<0.){o=vec4(0.);return;}',
        '  float t=-bb-sqrt(dsc),tf=-bb+sqrt(dsc);float dmin=9.;bool hit=false;vec3 pos=oL;',
        '  for(int i=0;i<96;i++){pos=oL+dL*t;float d=sdShuttle(pos);dmin=min(dmin,d);if(d<.0012){hit=true;break;}t+=d*.8;if(t>tf)break;}',
        '  float pw=length(oc)*(2.*uTan/uRes.y)*1.1;',
        '  cover=hit?1.:clamp(1.-dmin/pw,0.,1.);',
        '  if(cover<=0.){o=vec4(0.);return;}',
        '  vec3 e=vec3(.0016,-.0016,0.);',
        '  vec3 nl=normalize(e.xyy*sdShuttle(pos+e.xyy)+e.yyx*sdShuttle(pos+e.yyx)+e.yxy*sdShuttle(pos+e.yxy)+e.xxx*sdShuttle(pos+e.xxx));',
        '  if(dot(nl,dL)>0.)nl=-nl;',
        '  n=normalize(nl*uRinv);nW=n;q=pos;',
        '  float dH=sdHead(pos),dS=sdSkirt(pos),dR=sdRim(pos),dT=sdThr(pos);',
        '  float th=atan(pos.z,pos.x);',
        '  if(dH<=min(min(dS,dR),dT)){',
        '   vec4 pb=pebble(pos*34.);base=vec3(.83,.63,.42)*(.88+.12*smoothstep(.1,.55,pb.x));',
        '   base=mix(base,vec3(.95,.90,.80),smoothstep(-.62,-.40,pos.y)*.55);spec=.12;specPow=16.;',
        '  }else if(dR<=min(dS,dT)){base=vec3(.86,.33,.12);spec=.25;specPow=26.;',
        '  }else if(dT<=dS){base=vec3(.92,.86,.70);spec=.1;',
        '  }else{',
        '   float rib=.5+.5*cos(th*16.);float yy=clamp((pos.y+.28)/1.1,0.,1.);',
        '   base=mix(vec3(.93,.88,.76),vec3(.98,.98,.95),smoothstep(.0,.45,yy));',
        '   base*=.84+.16*rib;',
        '   float vein=smoothstep(.93,1.,sin(th*48.+pos.y*3.))*.06;base-=vein;',
        '   if(dot(nl,normalize(vec3(pos.x,0.,pos.z)))<0.)base*=.78;',
        '   spec=.14;specPow=24.;rimAmt=.3;rimCol=vec3(1.,.92,.8);',
        '  }',
        ' }',
        ' vec3 L=normalize(vec3(-.55,.78,.62));vec3 H=normalize(L+V);',
        ' float wrap=max((dot(n,L)+.45)/1.45,0.);',
        ' vec3 amb=mix(vec3(.07,.10,.07),vec3(.34,.24,.15),n.y*.5+.5);',
        ' float fres=pow(1.-max(dot(n,V),0.),3.);',
        ' float rimMask=max(dot(n,normalize(vec3(.8,.35,-.45)))+.45,0.);',
        ' vec3 col=base*(amb+wrap*1.05*vec3(1.,.95,.88))+rimCol*fres*rimMask*rimAmt;',
        ' col+=pow(max(dot(n,H),0.),specPow)*spec*(1.-line)*vec3(1.,.93,.82);',
        ' col*=mix(.62,1.,smoothstep(-1.,.25,nW.y));',
        ' o=vec4(col*cover,cover);',
        '}'
    ].join('\n');

    function compile(type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
    }
    var prog;
    try {
        prog = gl.createProgram();
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) {
        if (window.console) console.warn('Balls disabled:', e.message);
        box.parentNode.removeChild(box);
        return;
    }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var U = {};
    ['uRes', 'uC', 'uS', 'uRinv', 'uGy', 'uShadow', 'uType', 'uPass', 'uOff', 'uTan'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    /* ------------------------------------------------------------------ the pile */
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var GROUND = AUTH ? -0.82 : -0.78;   // y of the floor
    var G = 11;                  // gravity
    var TAN = 0.2679;            // tan(15deg): camera half field of view
    var CAM_Z = 7;
    var TANV = TAN, OFF = [0, 0];   // field of view + image shift (only the Home hero layer changes these)
    var REST = 0.62;             // how much height each bounce keeps
    function qmul(a, b) {
        return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
                a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
                a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
                a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
    }
    function qaxis(ax, ang) {
        var l = Math.hypot(ax[0], ax[1], ax[2]) || 1, s = Math.sin(ang / 2) / l;
        return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)];
    }
    function qnorm(a) { var l = Math.hypot(a[0], a[1], a[2], a[3]) || 1; return [a[0] / l, a[1] / l, a[2] / l, a[3] / l]; }
    /* rotation matrix, row-major numbers; given to GLSL untransposed it becomes the inverse rotation */
    function invMat(a) {
        var x = a[0], y2 = a[1], z = a[2], ww = a[3];
        return new Float32Array([
            1 - 2 * (y2 * y2 + z * z), 2 * (x * y2 - z * ww), 2 * (x * z + y2 * ww),
            2 * (x * y2 + z * ww), 1 - 2 * (x * x + z * z), 2 * (y2 * z - x * ww),
            2 * (x * z - y2 * ww), 2 * (y2 * z + x * ww), 1 - 2 * (x * x + y2 * y2)]);
    }

    /* type: 0 basketball, 1 volleyball, 2 tennis ball, 3 shuttlecock. x, z = where it sits, r = size.
       side: which edge it is thrown in from on the login / register pages. */
    var DEFS = [
        { type: 0, side: -1, x: -0.92, z: -0.10, r: 0.72, lift: 1.00, H: 0.95, spin: [0.10, 0.42, 0.00], q: qmul(qaxis([1, 0, 0], 0.32), qaxis([0, 1, 0], -0.5)) },
        { type: 1, side: 1, x: 0.62, z: -0.45, r: 0.68, lift: 1.00, H: 1.00, spin: [0.08, -0.36, 0.00], q: qmul(qaxis([1, 0, 0], 0.5), qaxis([0, 1, 0], 0.8)) },
        { type: 2, side: -1, x: -0.22, z: 1.40, r: 0.38, lift: 1.00, H: 0.80, spin: [0.14, 0.55, 0.00], q: qmul(qaxis([1, 0, 0], 0.4), qaxis([0, 1, 0], 0.3)) },
        { type: 3, side: 1, x: 1.00, z: 0.95, r: 0.54, lift: 0.93, H: 0.80, spin: [0.00, 0.90, 0.00], q: qmul(qaxis([0, 0, 1], 0.5), qaxis([1, 0, 0], 0.35)) }
    ];
    var balls = DEFS.map(function (d, i) {
        var o = {};
        for (var k in d) o[k] = d[k];
        o.w = [0, 0, 0]; o.y = 0; o.vy = 0; o.air = false; o.sq = 0; o.sqv = 0;
        o.t = i * 2.1;                                    // float phase
        o.tx = o.x; o.thrown = false; o.placed = false;
        o.wait = calm ? 0 : 0.25 + i * 0.22;              // staggered entrance at load
        o.cy = 0;                                         // current centre height, for picking
        return o;
    });
    var order = balls.slice().sort(function (a, b) { return a.z - b.z; });   // draw the far ones first

    var t0 = performance.now();
    var hoverBall = null, lastX = 0, lastY = 0, down = null;
    var cssW = 400, cssH = 400, dpr = 1, visible = true, active = true;
    var cardEl = AUTH ? page.querySelector('.auth-card') : null;

    /* login / register: work out where the balls sit from the position of the form card */
    function layoutAuth() {
        var pr = page.getBoundingClientRect(), cr = cardEl.getBoundingClientRect();
        var cl = cr.left - pr.left, cRight = cr.right - pr.left;
        var leftW = cl, rightW = cssW - cRight;
        active = Math.min(leftW, rightW) >= 150;
        canvas.style.visibility = active ? 'visible' : 'hidden';
        if (!active) return;
        var wpp = (2 * TAN * CAM_Z) / cssH;                // world units per pixel at the ball plane
        var Rpx = Math.min(Math.min(leftW, rightW) * 0.23, cssH * 0.16);
        var R = Rpx * wpp;
        var xcL = (cl / 2 - cssW / 2) * wpp, xcR = ((cRight + cssW) / 2 - cssW / 2) * wpp;
        var edge = (cssW / 2) * wpp + 2.2 * R;             // just off screen
        var L = [
            { x: xcL + 0.22 * R, z: -0.05, r: 1.00 * R },  // basketball
            { x: xcR - 0.22 * R, z: -0.15, r: 0.96 * R },  // volleyball
            { x: xcL - 0.70 * R, z: 1.15, r: 0.58 * R },   // tennis ball
            { x: xcR + 0.80 * R, z: 0.95, r: 0.80 * R }    // shuttlecock
        ];
        balls.forEach(function (b, i) {
            var pf = (CAM_Z - L[i].z) / CAM_Z;                 // nearer balls look bigger and wider apart: pull them back in
            b.tx = L[i].x * pf; b.z = L[i].z; b.r = L[i].r * pf;
            if (!b.placed) {
                b.placed = true;
                if (calm) { b.x = b.tx; }
                else { b.x = b.side * edge; b.thrown = true; b.y = b.r * (0.9 + 0.5 * Math.random()); b.vy = 3.2; b.air = true; }
            } else if (!b.thrown) { b.x = b.tx; }
        });
        order.sort(function (a, b) { return a.z - b.z; });
    }

    /* Home: the layer covers the hero; the camera is shifted and widened so a ball sits exactly where
       it would have sat inside the old square box, then every ball starts off screen on its own side. */
    function layoutHero() {
        var hr = host.getBoundingClientRect(), br = box.getBoundingClientRect();
        cssW = Math.max(120, Math.round(hr.width));
        cssH = Math.max(120, Math.round(hr.height));
        active = br.width >= 200;
        canvas.style.visibility = active ? 'visible' : 'hidden';
        if (!active) return;
        var cx = br.left + br.width / 2 - hr.left, cy = br.top + br.height / 2 - hr.top;
        TANV = TAN * cssH / br.width;
        OFF = [(cx - cssW / 2) / (cssW / 2), -(cy - cssH / 2) / (cssH / 2)];
        var asp = cssW / cssH;
        balls.forEach(function (b) {
            var d = CAM_Z - b.z;
            b.tx = DEFS[balls.indexOf(b)].x;
            if (!b.placed) {
                b.placed = true;
                if (calm) { b.x = b.tx; }
                else {
                    b.x = b.side < 0 ? (-1 - OFF[0]) * d * TANV * asp - 2.2 * b.r
                                     : (1 - OFF[0]) * d * TANV * asp + 2.2 * b.r;
                    b.thrown = true; b.y = b.r * (0.9 + 0.5 * Math.random()); b.vy = 3.2; b.air = true;
                }
            } else if (!b.thrown) { b.x = b.tx; }
        });
    }

    function size() {
        var r = (host || box).getBoundingClientRect();
        dpr = Math.min(window.devicePixelRatio || 1, AUTH || host ? 1.4 : 1.75);
        cssW = Math.max(120, Math.round(r.width));
        cssH = (AUTH || host) ? Math.max(120, Math.round(r.height)) : cssW;
        var pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
        if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
        gl.viewport(0, 0, pw, ph);
        if (AUTH) layoutAuth(); else if (host) layoutHero();
    }

    /* ------------------------------------------------------------------ pointer */
    var evt = AUTH ? page : (host || canvas);
    function toNdc(e) {
        var r = canvas.getBoundingClientRect();
        return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
    }
    function onUi(e) {
        if (AUTH) return e.target.closest && e.target.closest('.auth-card, .auth-foot, a, button, input, select, textarea, label');
        return host && e.target.closest && e.target.closest('a, button, input, select, textarea, label');
    }
    function pick(e) {
        if (!active || onUi(e)) return null;
        var n = toNdc(e), asp = canvas.width / canvas.height;
        var rd = [(n[0] - OFF[0]) * TANV * asp, (n[1] - OFF[1]) * TANV, -1], l = Math.hypot(rd[0], rd[1], rd[2]);
        rd = [rd[0] / l, rd[1] / l, rd[2] / l];
        var best = null, bt = 1e9;
        balls.forEach(function (b) {
            if (b.wait > 0 || b.thrown) return;
            var oc = [-b.x, -b.cy, CAM_Z - b.z];
            var bb = oc[0] * rd[0] + oc[1] * rd[1] + oc[2] * rd[2];
            var rr = b.r * 1.08;
            var c = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - rr * rr;
            var disc = bb * bb - c;
            if (disc > 0) { var t = -bb - Math.sqrt(disc); if (t < bt) { bt = t; best = b; } }
        });
        return best;
    }
    if (!AUTH && !host) canvas.style.touchAction = 'pan-y';
    evt.addEventListener('pointermove', function (e) {
        var b = pick(e);
        if (b !== hoverBall) { hoverBall = b; evt.style.cursor = b ? 'pointer' : ''; }
        var tgt = down ? down.ball : b;
        if (tgt && (lastX || lastY)) {
            var dx = e.clientX - lastX, dy = e.clientY - lastY;
            tgt.w[0] += dy * 0.045; tgt.w[1] += dx * 0.045;
            var m = Math.hypot(tgt.w[0], tgt.w[1]);
            if (m > 16) { tgt.w[0] *= 16 / m; tgt.w[1] *= 16 / m; }
        }
        lastX = e.clientX; lastY = e.clientY;
    });
    evt.addEventListener('pointerleave', function () { hoverBall = null; lastX = lastY = 0; evt.style.cursor = ''; });
    evt.addEventListener('pointerdown', function (e) { var b = pick(e); if (b) down = { x: e.clientX, y: e.clientY, ball: b }; });
    window.addEventListener('pointerup', function (e) {
        if (!down) return;
        var moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), b = down.ball;
        down = null;
        if (moved < 9 && pick(e) === b) bounce(b);
    });
    if (!AUTH) (host ? box : canvas).addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        order.slice().reverse().forEach(function (b, i) { setTimeout(function () { bounce(b); }, i * 110); });
    });

    function bounce(b) {
        box.classList.add('touched');
        if (b.wait > 0) return;
        if (b.air && b.vy > 0 && b.y > 0.15) return;      // already flying up
        b.air = true;
        b.vy = Math.sqrt(2 * G * b.H * Math.max(0.5, Math.min(1, b.r / 0.6)));
        b.w[2] += (Math.random() < .5 ? -1 : 1) * 3.2;
        b.w[1] += (Math.random() - .5) * 5;
    }

    /* ------------------------------------------------------------------ frame */
    function step(b, dt) {
        if (b.wait > 0) { b.wait -= dt; return; }
        var k = Math.exp(-1.5 * dt);
        b.w[0] *= k; b.w[1] *= k; b.w[2] *= Math.exp(-0.9 * dt);
        if (b.thrown) {                                    // flies in from the side, then rolls to a stop
            var kx = host ? 2.4 : 3.2, dx = b.tx - b.x, vx = dx * kx;
            b.x += dx * (1 - Math.exp(-kx * dt));
            b.w[2] = -Math.max(-12, Math.min(12, vx / b.r)) * 0.8;
            if (Math.abs(b.tx - b.x) < 0.004) { b.x = b.tx; b.thrown = false; }
        }
        var wx = b.w[0] + (calm ? 0 : b.spin[0]), wy = b.w[1] + (calm ? 0 : b.spin[1]), wz = b.w[2] + (calm ? 0 : b.spin[2]);
        var sp = Math.hypot(wx, wy, wz);
        if (sp > 1e-5) b.q = qnorm(qmul(qaxis([wx, wy, wz], sp * dt), b.q));

        if (b.air) {
            b.vy -= G * dt; b.y += b.vy * dt;
            if (b.y <= 0 && b.vy < 0) {
                b.y = 0;
                var impact = -b.vy;
                if (impact < 1.3) { b.air = false; b.vy = 0; }
                else { b.vy = impact * Math.sqrt(REST); b.sqv += impact * 0.55; b.w[1] += (Math.random() - .5) * 2.4; }
            }
        }
        b.sqv += (-260 * b.sq - 20 * b.sqv) * dt; b.sq += b.sqv * dt;
        b.sq = Math.max(-0.1, Math.min(0.28, b.sq));
        b.t += dt;
    }

    function drawBall(b, pass) {
        var kk = (b.type === 3) ? 0.3 : 1;                  // the shuttlecock barely squashes
        var stretch = b.air ? Math.min(Math.abs(b.vy) * 0.012, 0.07) * kk : 0;
        var sy = 1 - b.sq * kk + stretch, sx = 1 + b.sq * 0.55 * kk - stretch * 0.4;
        var fl = (!b.air && !b.thrown && !calm) ? Math.sin(b.t * 1.7) * 0.02 * b.r : 0;
        var cy = GROUND + b.r * b.lift * sy + b.y + fl;
        b.cy = cy;
        gl.uniform3f(U.uC, b.x, cy, b.z);
        if (pass === 1) {
            var hn = (b.y + fl) / b.r;
            var sr = 0.95 * b.r * Math.max(0.35, 1 - hn * 0.32);
            gl.uniform2f(U.uShadow, sr, 0.62 * Math.max(0.12, 1 - hn * 0.42));
            var d1 = CAM_Z - b.z, W1 = canvas.width, H1 = canvas.height, a1 = W1 / H1, rr1 = sr * 1.9 / (d1 * TANV);
            var sx0 = Math.max(0, Math.floor((b.x / (d1 * TANV * a1) + OFF[0] - rr1 / a1) * W1 / 2 + W1 / 2)), sx1 = Math.min(W1, Math.ceil((b.x / (d1 * TANV * a1) + OFF[0] + rr1 / a1) * W1 / 2 + W1 / 2));
            var sy0 = Math.max(0, Math.floor((GROUND / (d1 * TANV) + OFF[1] - rr1) * H1 / 2 + H1 / 2)), sy1 = Math.min(H1, Math.ceil((GROUND / (d1 * TANV) + OFF[1] + rr1) * H1 / 2 + H1 / 2));
            if (sx1 <= sx0 || sy1 <= sy0) return;
            gl.scissor(sx0, sy0, sx1 - sx0, sy1 - sy0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            return;
        }
        // limit the work to the ball's own rectangle
        var d = CAM_Z - b.z, W = canvas.width, Hh = canvas.height, asp = W / Hh;
        var nx = b.x / (d * TANV * asp) + OFF[0], ny = cy / (d * TANV) + OFF[1];
        var nrx = (b.r * 1.3) / (d * TANV * asp), nry = (b.r * 1.3) / (d * TANV);
        var x0 = Math.max(0, Math.floor((nx - nrx) * W / 2 + W / 2)), x1 = Math.min(W, Math.ceil((nx + nrx) * W / 2 + W / 2));
        var y0 = Math.max(0, Math.floor((ny - nry) * Hh / 2 + Hh / 2)), y1 = Math.min(Hh, Math.ceil((ny + nry) * Hh / 2 + Hh / 2));
        if (x1 <= x0 || y1 <= y0) return;
        gl.scissor(x0, y0, x1 - x0, y1 - y0);
        gl.uniform3f(U.uS, sx * b.r, sy * b.r, sx * b.r);
        gl.uniform1f(U.uType, b.type);
        gl.uniformMatrix3fv(U.uRinv, false, invMat(b.q));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(now) {
        requestAnimationFrame(frame);
        if (!visible || !active || document.hidden) { t0 = now; return; }
        var dt = Math.min((now - t0) / 1000, 0.033); t0 = now;
        balls.forEach(function (b) { step(b, dt); });

        gl.disable(gl.SCISSOR_TEST);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(U.uRes, canvas.width, canvas.height);
        gl.uniform1f(U.uGy, GROUND);
        gl.uniform2f(U.uOff, OFF[0], OFF[1]);
        gl.uniform1f(U.uTan, TANV);
        gl.enable(gl.SCISSOR_TEST);
        gl.uniform1f(U.uPass, 1);                           // 1) shadows
        order.forEach(function (b) { if (b.wait <= 0) drawBall(b, 1); });
        gl.uniform1f(U.uPass, 0);                           // 2) balls, far to near
        order.forEach(function (b) { if (b.wait <= 0) drawBall(b, 0); });
    }

    size();
    if (window.ResizeObserver) {
        var ro = new ResizeObserver(size);
        ro.observe(box);
        if (host) ro.observe(host);
        if (cardEl) ro.observe(cardEl);
    } else window.addEventListener('resize', size);
    if (window.IntersectionObserver) new IntersectionObserver(function (en) { visible = en[0].isIntersecting; }).observe(host || box);
    requestAnimationFrame(frame);
})();
