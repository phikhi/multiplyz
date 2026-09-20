/* Isolated pilot scene derived from the accepted 02 + 03 art study. */
import * as THREE from "./three.module.min.js";
import { buildBiome } from "./biomes.js";
import { dressTeddy } from "./teddy-accessories.js";
export function createTeddyForest(root, options = {}){
  const game=root.querySelector(".tp-scene"),holder=root.querySelector(".tp-world");
  const state={variant:"hybrid",phase:"arrival",paused:false};
  let renderer, scene, camera, world, bear, friend, portal, clockLast=0, raf, viewRatio=1.5, viewWidth=1024, viewHeight=690;
  let updateWorld=()=>{}, mapPoint=new THREE.Vector3(), cameraBase=new THREE.Vector3(), lookBase=new THREE.Vector3();
  let floaters=[], sway=[], particles=[], growth=[], rings=[], bearEyes=[], arms=[], feet=[], currentFrame=0;
  let mouse={x:0,y:0}, smoothMouse={x:0,y:0};
  const geomSphere=new THREE.SphereGeometry(1,24,18);
  let seed=104 + (Number.isSafeInteger(options.worldIndex) ? options.worldIndex * 977 : 0);
  const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const range=(a,b)=>a+(b-a)*rand();
  const vec=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
  function canvasTexture(draw,size=128){const c=document.createElement('canvas');c.width=c.height=size;draw(c.getContext('2d'),size);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;}
  const glowTexture=canvasTexture((c,s)=>{const g=c.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);g.addColorStop(0,'#fff');g.addColorStop(.12,'#fff');g.addColorStop(.3,'#ffffff80');g.addColorStop(1,'#ffffff00');c.fillStyle=g;c.fillRect(0,0,s,s);});
  const shadowTexture=canvasTexture((c,s)=>{const g=c.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);g.addColorStop(0,'#00000080');g.addColorStop(1,'#00000000');c.fillStyle=g;c.fillRect(0,0,s,s);});
  const furTexture=canvasTexture((c,s)=>{c.fillStyle='#b6b6b6';c.fillRect(0,0,s,s);for(let i=0;i<6000;i++){const q=Math.floor(range(115,215));c.fillStyle=`rgb(${q},${q},${q})`;c.fillRect(rand()*s,rand()*s,1,2);}},128);
  furTexture.wrapS=furTexture.wrapT=THREE.RepeatWrapping;furTexture.repeat.set(4,4);furTexture.colorSpace=THREE.NoColorSpace;
  function mat(color,opts={}){return new THREE.MeshStandardMaterial({color,roughness:.87,metalness:0,...opts});}
  function mesh(geometry,material,parent=world,x=0,y=0,z=0){const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  function ball(parent,x,y,z,sx,sy,sz,material){const m=mesh(geomSphere,material,parent,x,y,z);m.scale.set(sx,sy,sz);return m;}
  function tube(points,radius,material,parent=world,segments=36){return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>vec(...p))),segments,radius,8,false),material,parent);}
  function glow(parent,color,x,y,z,size=2,intensity=1){const s=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,color,transparent:true,opacity:intensity,depthWrite:false,blending:THREE.AdditiveBlending}));s.position.set(x,y,z);s.scale.setScalar(size);parent.add(s);return s;}
  function contact(parent,x,y,z,sx,sz,opacity=.3){const m=mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,opacity,depthWrite:false}),parent,x,y,z);m.rotation.x=-Math.PI/2;m.scale.set(sx,sz,1);m.castShadow=false;return m;}
  function makeBear(parent,scale=1){
    const g=new THREE.Group();parent.add(g);g.scale.setScalar(scale);
    const fur=mat('#bd8a49',{bumpMap:furTexture,bumpScale:.045}),cream=mat('#e8c88b',{bumpMap:furTexture,bumpScale:.025}),dark=mat('#27251f',{roughness:.34});
    ball(g,0,1.03,0,.58,.71,.44,fur);ball(g,0,1.02,.365,.42,.47,.14,cream);
    const head=new THREE.Group();head.position.set(0,1.91,.035);g.add(head);g.userData.head=head;
    ball(head,0,0,0,.66,.59,.52,fur);
    for(const sign of [-1,1]){
      ball(head,sign*.49,.47,-.01,.235,.25,.17,fur);ball(head,sign*.49,.47,.14,.15,.16,.048,cream);
      const foot=new THREE.Group();foot.position.set(sign*.36,.29,.18);g.add(foot);ball(foot,0,0,0,.285,.28,.38,fur);ball(foot,0,.035,.32,.20,.17,.062,cream);feet.push({node:foot,sign});
      const arm=new THREE.Group();arm.position.set(sign*.53,1.4,0);g.add(arm);ball(arm,sign*.04,-.2,.03,.22,.39,.23,fur);ball(arm,sign*.06,-.4,.12,.16,.14,.14,cream);arm.rotation.z=sign*.22;arms.push({node:arm,sign});
      const eye=ball(head,sign*.245,.055,.488,.074,.084,.051,dark);bearEyes.push(eye);ball(eye,-.23,.28,.7,.20,.21,.18,mat('#fffae6',{roughness:.18}));
    }
    ball(head,0,-.15,.48,.335,.24,.20,cream);ball(head,0,-.045,.68,.108,.076,.06,dark);
    tube([[0,-.09,.685],[0,-.2,.695],[-.085,-.215,.68]],.012,dark,head,10);tube([[0,-.2,.695],[.085,-.215,.68]],.012,dark,head,8);
    const smile=tube([[-.11,-.19,.683],[0,-.24,.704],[.11,-.19,.683]],.014,dark,head,12);g.userData.smile=smile;smile.visible=false;
    // A few soft tufts keep the silhouette plush without thousands of hairs.
    for(let i=0;i<7;i++)ball(head,(i-3)*.07,.53+Math.sin(i*1.6)*.015,.035,.075,.09,.10,fur);
    const tag=mesh(new THREE.BoxGeometry(.12,.18,.055),mat('#e8c54e'),head,.64,.4,.02);tag.rotation.z=.18;ball(head,.64,.44,.06,.018,.018,.018,dark);
    ball(g,0,.7,-.43,.18,.17,.16,fur);
    g.userData.outfitMotion=dressTeddy(g,options.kind,{mesh,mat,ball,tube});
    return g;
  }
  function makeFriend(parent,kind='leaf'){const g=new THREE.Group();parent.add(g);const body=mat(kind==='sky'?'#9bdaca':'#a6cfa2'),cream=mat('#fff3d3');
    ball(g,0,.5,0,.35,.39,.32,body);ball(g,0,.48,.28,.26,.24,.06,cream);
    for(const s of [-1,1]){const ear=ball(g,s*.21,.91,0,.13,.28,.11,body);ear.rotation.z=-s*.3;ball(g,s*.12,.56,.335,.03,.046,.025,mat('#203b3a'));ball(g,s*.18,.44,.34,.06,.03,.02,mat('#eaa994'));}
    ball(g,0,.45,.355,.025,.02,.023,mat('#586052'));contact(g,0,.025,0,1,1,.2);return g;
  }
  function island(parent,x,y,z,r=5,color='#739f79'){const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);
    const profile=[[0,-r*.7],[r*.25,-r*.65],[r*.73,-r*.4],[r*.94,-r*.16],[r,0],[r*.96,.15],[r*.78,.22],[0,.22]].map(p=>new THREE.Vector2(...p));
    const land=mesh(new THREE.LatheGeometry(profile,48),mat(color),g);land.receiveShadow=true;
    const base=mesh(new THREE.ConeGeometry(r*.86,r*.68,9),mat('#687e69',{flatShading:true}),g,0,-r*.42,0);base.rotation.z=Math.PI;
    ball(g,-r*.26,-r*.35,r*.32,r*.36,r*.23,r*.29,mat('#98a57a'));
    return g;
  }
  function tree(parent,x,y,z,size=1,color='#81b49b'){const g=new THREE.Group();g.position.set(x,y,z);g.scale.setScalar(size);parent.add(g);const wood=mat('#8a7960');
    tube([[0,0,0],[.06,1,0],[-.05,2.5,.04]],.16,wood,g);
    for(const s of [-1,1])tube([[0,1.2,0],[s*.36,1.7,0],[s*.7,2.05,.04]],.075,wood,g,12);
    const leaves=mat(color);for(let i=0;i<8;i++){const a=i*2.4;ball(g,Math.cos(a)*.63,2.25+Math.sin(i*1.7)*.28,Math.sin(a)*.48,.67,.61,.62,leaves);}ball(g,0,2.8,0,.68,.53,.6,leaves);
    sway.push({node:g,phase:rand()*6,strength:.018});contact(parent,x,y+.03,z,2.7*size,2.7*size,.13);return g;
  }
  function flower(parent,x,y,z,size=1,color='#e9b982',closed=false){const g=new THREE.Group();g.position.set(x,y,z);g.scale.setScalar(size);parent.add(g);
    tube([[0,0,0],[.02,.24,0],[0,.55,0]],.035,mat('#62946b'),g,8);
    const petals=new THREE.Group();petals.position.y=.58;g.add(petals);const pm=mat(color);for(let i=0;i<5;i++){const a=i*Math.PI*.4;const petal=ball(petals,Math.cos(a)*.17,.02,Math.sin(a)*.17,.18,.075,.15,pm);petal.rotation.y=-a;}
    ball(petals,0,.08,0,.11,.08,.11,mat('#f9d368'));if(closed){petals.scale.setScalar(.08);growth.push({node:petals,delay:rand()*.45,base:1});}
    sway.push({node:g,phase:rand()*6,strength:.06});return g;
  }
  function sprinkle(parent,amount,span,yMin,yMax,color='#ffdc8d'){for(let i=0;i<amount;i++){const p=glow(parent,color,range(-span,span),range(yMin,yMax),range(-span,span),range(.055,.16),.7);particles.push({node:p,origin:p.position.clone(),phase:rand()*9,speed:range(.2,.7),scale:p.scale.x});}}
  function skyBackground(top,bottom){scene.background=canvasTexture((c,s)=>{const g=c.createLinearGradient(0,0,0,s);g.addColorStop(0,top);g.addColorStop(1,bottom);c.fillStyle=g;c.fillRect(0,0,s,s);},64);}
  function lights(sky,ground,intensity=2,key='#fff0cf',keyPower=4){scene.add(new THREE.HemisphereLight(sky,ground,intensity));const sun=new THREE.DirectionalLight(key,keyPower);sun.position.set(-7,15,8);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-16;sun.shadow.camera.right=16;sun.shadow.camera.top=16;sun.shadow.camera.bottom=-16;sun.shadow.normalBias=.04;sun.shadow.bias=-.00015;sun.shadow.radius=4;scene.add(sun);return sun;}
  function makePortal(parent,x,y,z,size=1,color='#ffe7aa'){const g=new THREE.Group();g.position.set(x,y,z);g.scale.setScalar(size);parent.add(g);
    const arch=[];for(let i=0;i<=40;i++){const a=Math.PI-i*Math.PI/40;arch.push([Math.cos(a)*1.05,1.15+Math.sin(a)*1.05,0]);}arch.unshift([-1.05,0,0]);arch.push([1.05,0,0]);
    tube(arch,.21,mat('#ead8a6'),g,64);tube(arch.map(p=>[p[0]*.94,p[1],.22]),.035,mat(color,{emissive:color,emissiveIntensity:2.2}),g,64);
    const disc=mesh(new THREE.CircleGeometry(1,64),new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{uTime:{value:0},uOpen:{value:0},uColor:{value:new THREE.Color(color)}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv;uniform float uTime;uniform float uOpen;uniform vec3 uColor;void main(){vec2 p=vUv-.5;float r=length(p)*2.;float wave=sin(r*26.-uTime*2.)*.5+.5;float edge=1.-smoothstep(.5,1.,r);float power=(.1+uOpen*.9);gl_FragColor=vec4(uColor*(.35+wave*.22+uOpen*.7),edge*power*.74);}' }),g,0,1.1,0);
    disc.scale.set(1,1.9,1);disc.castShadow=false;g.userData.disc=disc;glow(g,color,0,1.1,.1,4,.25);return g;
  }
  function mushroom(parent,x,y,z,size=1,color='#78dacc'){const g=new THREE.Group();parent.add(g);g.position.set(x,y,z);g.scale.setScalar(size);
    mesh(new THREE.CylinderGeometry(.08,.16,.72,10),mat('#8bbaa3'),g,0,.35,0);
    const cap=mesh(new THREE.SphereGeometry(.61,24,12,0,Math.PI*2,0,Math.PI*.52),mat(color,{emissive:color,emissiveIntensity:.3,roughness:.65}),g,0,.66,0);cap.scale.y=.55;
    mesh(new THREE.CircleGeometry(.6,32),mat('#b1ead1',{emissive:'#9de6ba',emissiveIntensity:.7,side:THREE.DoubleSide}),g,0,.64,0).rotation.x=-Math.PI/2;
    glow(g,color,0,.45,0,2.4,.15);for(let i=0;i<5;i++)ball(g,Math.cos(i*2.4)*.34,.93,Math.sin(i*2.4)*.34,.055,.025,.055,mat('#cbedcd'));return g;
  }
  function giantTree(parent,x,z,height,width,color){const g=new THREE.Group();parent.add(g);g.position.set(x,-2,z);const m=mat(color);tube([[0,-3,0],[.3,1,0],[-.2,height*.45,0],[.3,height,0]],width,m,g,32);
    for(const s of [-1,1]){tube([[0,height*.36,0],[s*2,height*.5,.1],[s*3.9,height*.68,.3]],width*.35,m,g,22);tube([[0,0,0],[s*1.4,-.7,1],[s*3,-1,1.5]],width*.42,m,g,16);}
    for(let j=0;j<5;j++){const start=j*.6;const twig=mat(color);tube([[.2,height*.6+start,0],[range(-4,4),height*.8+start,0],[range(-5,5),height+start,0]],width*.13,twig,g,12);}
    return g;
  }
  function hybridScene(){
    skyBackground('#0b2c36','#396f64');scene.fog=new THREE.FogExp2('#275a56',.024);
    const sun=lights('#80b9ae','#254238',1.45,'#f1e9b3',2.5);sun.position.set(-9,23,-12);
    camera=new THREE.PerspectiveCamera(55,viewRatio,.1,170);cameraBase.set(0,8,20);lookBase.set(0,2,-2);
    // A continuous forest floor replaces the separate islands of the sky study.
    mesh(new THREE.PlaneGeometry(100,115),mat('#294c40'),world,0,-.05,-25).rotation.x=-Math.PI/2;
    const pathX=z=>Math.sin((z-6.7)*.17)*.85;
    const points=[],uvs=[],indices=[];
    for(let i=0;i<=60;i++){const z=17-i*.7,x=pathX(z),w=1.8+Math.sin(i*.23)*.18;points.push(x-w,.035,z,x+w,.035,z);uvs.push(0,i/60,1,i/60);if(i<60){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}}
    const ribbon=new THREE.BufferGeometry();ribbon.setAttribute('position',new THREE.Float32BufferAttribute(points,3));ribbon.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));ribbon.setIndex(indices);ribbon.computeVertexNormals();mesh(ribbon,mat('#719775'),world);
    // Dense side banks retain the enclosed, layered silhouette of direction 02.
    const mossMats=['#446d52','#527f5f','#385e4b'].map(c=>mat(c));
    for(let i=0;i<48;i++){const z=range(-35,15),s=i%2?1:-1,x=s*range(2.3,12)+pathX(z);ball(world,x,-.08,z,range(.55,1.8),range(.16,.48),range(.5,1.5),mossMats[i%3]);}
    for(const side of [-1,1]){
      for(let i=0;i<6;i++){const z=9-i*8.2,x=side*(6.9+range(-.65,1.2));const height=range(19,26),width=range(.85,1.4);giantTree(world,x,z,height,width,i<2?'#193f38':'#2c5850');
        // Bent branches meet above the path, forming a living vault.
        tube([[x,6.8,z],[x*.82,9.7,z-1],[x*.35,11.1,z-3],[-side*.8,10.2,z-5]],.32,mat('#2e5747'),world,28);
        tube([[x,.2,z],[side*4,.14,z+1],[side*2.05,.04,z+3]],.22,mat('#5e7957'),world,20);
      }
      for(let i=0;i<8;i++)giantTree(world,side*range(12,22),-38+i*7,range(19,29),range(.5,1),'#34665b');
    }
    giantTree(world,1,-29,29,2.1,'#3b6650');
    // Rounded leaf masses are held high; fine foliage frames the foreground.
    const leaves=mat('#315f4b');for(let i=0;i<22;i++){const z=range(-32,9),s=i%2?1:-1;ball(world,s*range(4.5,10),range(10,14),z,range(2,3.8),range(.5,1.2),range(1.5,3),leaves);}
    const leafMat=mat('#4d8768');for(let i=0;i<28;i++){const g=new THREE.Group();g.position.set(range(-9,9),range(8.7,12),range(-25,11));world.add(g);tube([[0,.4,0],[.12,-.8,.1],[-.2,-2.4,.2]],.027,mat('#63876a'),g,10);for(let j=0;j<5;j++){const l=ball(g,j%2?.16:-.18,-j*.43,0,.36,.07,.14,leafMat);l.rotation.z=j%2?.38:-.45;}sway.push({node:g,phase:rand()*7,strength:.045});}
    for(let i=0;i<37;i++){const z=range(-25,12),s=i%2?1:-1;const x=pathX(z)+s*range(2.2,5.2);mushroom(world,x,.02,z,range(.5,1.65),i%4?'#8bd7b8':'#eccc90');}
    mushroom(world,-4.6,.1,8.5,2.2,'#9cdbb8');mushroom(world,5,.07,6.5,2.4,'#d5d698');
    // Ferns occupy the sides rather than the readable path.
    for(let i=0;i<18;i++){const fern=new THREE.Group();const z=range(-21,12);fern.position.set((i%2?1:-1)*range(3.5,7.7),.12,z);world.add(fern);for(let j=0;j<7;j++){const a=(j-3)*.28;const f=ball(fern,Math.sin(a)*.52,.45+Math.cos(a)*.2,0,.065,.85,.2,mat('#3f7855'));f.rotation.z=-a;}sway.push({node:fern,phase:rand()*6,strength:.035});}
    // The destination is an opening in roots, with warm light from within.
    portal=makePortal(world,pathX(-23),.02,-23,2,'#eadf9f');portal.children[0].material.color.set('#6b8967');portal.children[1].material.emissiveIntensity=1.35;
    for(const side of [-1,1])tube([[side*2.25,0,-23],[side*2.7,2.2,-23.1],[side*2.25,4.9,-23.7],[side*.45,6.5,-25]],.41,mat('#456d4d'),world,32);
    const welcomeLight=new THREE.PointLight('#ffdb94',24,15,2);welcomeLight.position.set(0,2.3,-21);world.add(welcomeLight);
    glow(world,'#f9e3a6',0,3,-23,11,.17);
    const distantMoon=ball(world,-4,16,-49,6,6,.2,new THREE.MeshBasicMaterial({color:'#c9dfae'}));distantMoon.castShadow=false;
    // Gentle shafts cross the corridor instead of sitting on top of the interface.
    for(let i=0;i<5;i++){const beam=mesh(new THREE.PlaneGeometry(range(.7,1.4),21),new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv;void main(){float a=pow(sin(vUv.x*3.14159),1.5)*sin(vUv.y*3.14159)*.08;gl_FragColor=vec4(.8,.91,.64,a);}'}),world,2+i*1.1,8,-7-i*4);beam.rotation.z=-.36;beam.castShadow=false;}
    bear=makeBear(world,1.2);bear.position.set(0,.04,6.7);bear.rotation.y=Math.PI;bear.userData.shadow=contact(world,0,.04,6.7,2.3,1.9,.85);
    // A companion waits just to the side, so the trail stays visibly continuous.
    friend=makeFriend(world);friend.position.set(1.2,.1,-17.5);friend.scale.setScalar(.001);
    const nearLight=new THREE.PointLight('#ffe1a4',24,10,2);nearLight.position.set(-2,4,3);bear.add(nearLight);
    for(let i=0;i<58;i++){const a=i/57,z=5.5-a*28,x=pathX(z)+(i%2?1:-1)*(.95+Math.sin(a*6)*.16),y=.19+Math.sin(a*Math.PI)*.22;const light=glow(world,'#fff1a0',x,y,z,.17,.9);light.scale.setScalar(.001);growth.push({node:light,delay:a*.62,base:.19});}
    for(let i=0;i<10;i++){const a=i/9;glow(world,'#ffe7a6',-1.2+Math.sin(a*4)*.15,.65+a*.35,6.4-a*2,.085,.85);}
    sprinkle(world,80,13,.5,9,'#e3ed9e');mapPoint.set(1.2,5.8,-23);
    updateWorld=(t,e)=>{portal.userData.disc.material.uniforms.uTime.value=t;portal.userData.disc.material.uniforms.uOpen.value=e;welcomeLight.intensity=24+e*17;};
  }
  // A compact bloom pipeline: bright-pass, two separable blurs, tone mapping.
  let target,bright,blur,postScene,postCamera,quad,brightMat,blurMat,finalMat;
  function setupRenderer(){
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;holder.appendChild(renderer.domElement);
    const opts={type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter};target=new THREE.WebGLRenderTarget(1,1,opts);bright=new THREE.WebGLRenderTarget(1,1,opts);blur=new THREE.WebGLRenderTarget(1,1,opts);
    postScene=new THREE.Scene();postCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const vs='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
    brightMat=new THREE.ShaderMaterial({uniforms:{tex:{value:target.texture}},vertexShader:vs,fragmentShader:'varying vec2 vUv;uniform sampler2D tex;void main(){vec3 c=texture2D(tex,vUv).rgb;float l=max(max(c.r,c.g),c.b);gl_FragColor=vec4(c*smoothstep(.85,1.8,l),1.);}'});
    blurMat=new THREE.ShaderMaterial({uniforms:{tex:{value:bright.texture},direction:{value:new THREE.Vector2()}},vertexShader:vs,fragmentShader:'varying vec2 vUv;uniform sampler2D tex;uniform vec2 direction;void main(){vec3 c=texture2D(tex,vUv).rgb*.227027;c+=texture2D(tex,vUv+direction*1.384615).rgb*.316216;c+=texture2D(tex,vUv-direction*1.384615).rgb*.316216;c+=texture2D(tex,vUv+direction*3.230769).rgb*.070270;c+=texture2D(tex,vUv-direction*3.230769).rgb*.070270;gl_FragColor=vec4(c,1.);}'});
    finalMat=new THREE.ShaderMaterial({uniforms:{tex:{value:target.texture},bloom:{value:bright.texture},strength:{value:.3},exposure:{value:1}},vertexShader:vs,fragmentShader:'varying vec2 vUv;uniform sampler2D tex;uniform sampler2D bloom;uniform float strength;uniform float exposure;vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}void main(){vec3 c=texture2D(tex,vUv).rgb+texture2D(bloom,vUv).rgb*strength;c=aces(c*exposure);c=mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c));gl_FragColor=vec4(c,1.);}'});
    quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),finalMat);postScene.add(quad);
  }
  function renderGL(){renderer.setRenderTarget(target);renderer.render(scene,camera);quad.material=brightMat;renderer.setRenderTarget(bright);renderer.render(postScene,postCamera);quad.material=blurMat;blurMat.uniforms.tex.value=bright.texture;blurMat.uniforms.direction.value.set(1.7/bright.width,0);renderer.setRenderTarget(blur);renderer.render(postScene,postCamera);blurMat.uniforms.tex.value=blur.texture;blurMat.uniforms.direction.value.set(0,1.7/bright.height);renderer.setRenderTarget(bright);renderer.render(postScene,postCamera);quad.material=finalMat;renderer.setRenderTarget(null);renderer.render(postScene,postCamera);}
  function resize(){viewWidth=holder.clientWidth;viewHeight=holder.clientHeight;viewRatio=viewWidth/viewHeight;renderer.setSize(viewWidth,viewHeight);const ratio=renderer.getPixelRatio();target.setSize(Math.round(viewWidth*ratio),Math.round(viewHeight*ratio));bright.setSize(Math.round(viewWidth*.5),Math.round(viewHeight*.5));blur.setSize(bright.width,bright.height);
    if(camera?.isOrthographicCamera){const h=state.variant==='garden'?8:7.4;camera.left=-h*viewRatio;camera.right=h*viewRatio;camera.top=h;camera.bottom=-h;}else if(camera)camera.aspect=viewRatio;camera?.updateProjectionMatrix();
  }
  function clearScene(){if(!scene)return;const geometries=new Set(),materials=new Set();scene.traverse(o=>{if(o.geometry&&o.geometry!==geomSphere)geometries.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());scene.background?.dispose?.();}

  scene=new THREE.Scene();world=new THREE.Group();scene.add(world);setupRenderer();
  const kind = options.kind || 'forest';
  if(kind === 'forest') hybridScene();
  else {
    camera=new THREE.PerspectiveCamera(55,viewRatio,.1,170);
    const biome=buildBiome(kind,{world,scene,mesh,mat,ball,tube,glow,range,rand,island,tree,flower,sway,growth,particles,skyBackground,lights,makePortal});
    portal=biome.portal; updateWorld=biome.update;
    bear=makeBear(world,1.2);bear.position.set(0,.04,6.7);bear.rotation.y=Math.PI;
    bear.userData.shadow=contact(world,0,.04,6.7,2.3,1.9,.65);
    friend=makeFriend(world);friend.visible=false;
    const nearLight=new THREE.PointLight('#ffe1ba',22,10,2);nearLight.position.set(-2,4,3);bear.add(nearLight);
  }
  game.dataset.biome=kind;
  resize();
  renderer.shadowMap.needsUpdate=true;bear.userData.shadow.renderOrder=10;
  // Moving characters use their own contact shadows; the forest is baked once.
  bear.traverse(o=>{o.castShadow=false;});friend.traverse(o=>{o.castShadow=false;});
  const pools=[],halo=[];
  for(let i=0;i<10;i++){const z=5.2-i*2.8;const m=mesh(new THREE.PlaneGeometry(2.5,2.5),new THREE.MeshBasicMaterial({map:glowTexture,color:'#efd581',transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}),world,Math.sin((z-6.7)*.17)*.85,.047,z);m.rotation.x=-Math.PI/2;m.castShadow=false;pools.push(m);}
  for(let i=0;i<20;i++){const p=glow(world,'#fff0a2',0,0,0,.001,.8);halo.push(p);}
  let progress=0,requested=0,time=0,last=0,dirty=true,disposed=false,entry=true,encounter=0;
  const currentCamera=vec(0,8,20),currentLook=vec(0,2,-2),pathX=z=>Math.sin((z-6.7)*.17)*.85;
  const approach=(v,target,rate,dt)=>v+(target-v)*(1-Math.exp(-rate*dt));
  const setState=next=>{if((next.completed||0)<(state.completed||0)){progress=0;encounter=0;entry=true;}Object.assign(state,next);friend.visible=kind==='forest'&&state.showFriend!==false;requested=(state.completed||0)/(state.total||10);dirty=true;};
  const ro=new ResizeObserver(()=>{resize();dirty=true;});ro.observe(holder);
  function pointer(e){const rect=holder.getBoundingClientRect();mouse.x=(e.clientX-rect.left)/rect.width*2-1;mouse.y=(e.clientY-rect.top)/rect.height*2-1;}
  function leave(){mouse.x=mouse.y=0;}
  game.addEventListener('pointermove',pointer);game.addEventListener('pointerleave',leave);
  function draw(stamp){
    if(disposed)return;
    if(!root.isConnected){dispose();return;}
    raf=requestAnimationFrame(draw);
    const dt=Math.min(.12,(stamp-last)/1000||.016);last=stamp;
    if(document.hidden)return;
    if(state.paused&&!entry){if(dirty){renderGL();dirty=false;}return;}
    if(state.reduced&&!dirty)return;
    const active=!state.paused&&!state.reduced;
    if(active)time+=dt;
    const step=state.reduced?1:dt;
    progress=(state.reduced||entry)?requested:approach(progress,requested,2.6,dt);
    if(Math.abs(progress-requested)<.0001)progress=requested;
    const moving=Math.min(1,Math.abs(progress-requested)*18);
    const ending=['finale','results','map','rest'].includes(state.phase);
    encounter=(state.reduced||entry)?(ending?1:0):approach(encounter,ending?1:0,2.1,dt);
    const facing=state.phase==='arrival'||state.phase==='help'||ending;
    const targetYaw=ending?.72:facing?.08:Math.PI;
    bear.rotation.y=state.reduced?targetYaw:approach(bear.rotation.y,targetYaw,5,dt);
    bear.position.z=6.7-progress*28;bear.position.x=pathX(bear.position.z);
    bear.position.y=.04+(active?Math.sin(time*1.8)*.02+Math.abs(Math.sin(time*8))*moving*.055:0);
    bear.rotation.z=active?Math.sin(time*8)*moving*.025:0;
    bear.userData.head.rotation.z=state.phase==='help'?-.12:active?Math.sin(time*1.2)*.025:0;
    bear.userData.head.rotation.y=state.phase==='feedback'?-.4:0;
    bear.userData.smile.visible=state.phase==='feedback'||ending;
    if(bear.userData.outfitMotion)bear.userData.outfitMotion.rotation.x=active?Math.sin(time*2)*.045:0;
    for(const f of feet)f.node.rotation.x=active?f.sign*Math.sin(time*8)*moving*.35:0;
    for(const a of arms){a.node.rotation.x=active?-a.sign*Math.sin(time*8)*moving*.3:0;a.node.rotation.z=a.sign*.22+(state.phase==='arrival'&&a.sign===-1?-.55+(active?Math.sin(time*3)*.1:0):0);}
    const blink=active&&time%5.6>5.43?.18:1;for(const eye of bearEyes)eye.scale.y=.084*blink;
    bear.userData.shadow.position.set(bear.position.x,.065,bear.position.z);
    friend.scale.setScalar(Math.max(.001,encounter*1.9));friend.position.set(3.2,.025+(active?Math.sin(time*2.3)*.045:0),-21.5);friend.rotation.y=.35;
    for(let i=0;i<growth.length;i++){const g=growth[i],amount=Math.max(0,Math.min(1,(progress-i/growth.length)*10));g.node.scale.setScalar(Math.max(.001,g.base*amount*(active?1+Math.sin(time*2+i)*.15:1)));}
    for(const p of particles){p.node.position.copy(p.origin);if(active){p.node.position.x+=Math.sin(time*p.speed+p.phase)*.3;p.node.position.y+=Math.sin(time*p.speed*1.4+p.phase)*.25;p.node.material.opacity=.46+Math.sin(time*1.4+p.phase)*.19;}}
    for(const s of sway)s.node.rotation.z=active?Math.sin(time*.7+s.phase)*s.strength:0;
    for(let i=0;i<pools.length;i++)pools[i].material.opacity=Math.max(0,Math.min(1,(progress-i/10)*10))*.3;
    for(let i=0;i<halo.length;i++){const a=i/halo.length*Math.PI*2+(active?time*.2:0),p=halo[i];p.position.set(.8+Math.cos(a)*1.9,1.1+Math.sin(a*2+(active?time*.4:0))*.5,-21.5+Math.sin(a)*1.35);p.scale.setScalar(Math.max(.001,encounter*.12));}
    updateWorld(time,progress);
    const desiredCamera=vec(pathX(bear.position.z)*.28,8,20-progress*28),desiredLook=vec(pathX(bear.position.z)*.25,2,-2-progress*28);
    desiredCamera.lerp(vec(6,4.7,-14.9),encounter);desiredLook.lerp(vec(.65,1.55,-21.9),encounter);
    smoothMouse.x=approach(smoothMouse.x,active?mouse.x:0,3,step);smoothMouse.y=approach(smoothMouse.y,active?mouse.y:0,3,step);
    if(active){desiredCamera.x+=smoothMouse.x*.24;desiredCamera.y-=smoothMouse.y*.10;}
    if(entry||state.reduced){currentCamera.copy(desiredCamera);currentLook.copy(desiredLook);entry=false;}else{currentCamera.lerp(desiredCamera,1-Math.exp(-5*dt));currentLook.lerp(desiredLook,1-Math.exp(-5*dt));}
    camera.position.copy(currentCamera);camera.lookAt(currentLook);renderGL();dirty=false;
    game.dataset.frames=String(++currentFrame);game.dataset.travel=progress.toFixed(3);root.querySelector('.tp-loading').hidden=true;
  }
  function dispose(){disposed=true;cancelAnimationFrame(raf);ro.disconnect();game.removeEventListener('pointermove',pointer);game.removeEventListener('pointerleave',leave);clearScene();geomSphere.dispose();glowTexture.dispose();shadowTexture.dispose();furTexture.dispose();target.dispose();bright.dispose();blur.dispose();brightMat.dispose();blurMat.dispose();finalMat.dispose();quad.geometry.dispose();renderer.dispose();renderer.domElement.remove();}
  raf=requestAnimationFrame(draw);
  return {setState,dispose};
}
