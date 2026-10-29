// Read-only prerequisite inventory. Never enrolls credentials, installs an app,
// changes environment/provider settings, or promotes a build check to login PASS.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{encoding:'utf8',timeout:15000});return {ok:r.status===0,output:r.stdout||''};};
const configured=JSON.parse(fs.readFileSync('mobile/auth-staging.public.json','utf8'));
const candidates=['adb',...(process.env.ANDROID_HOME?[path.join(process.env.ANDROID_HOME,'platform-tools/adb')]:[]),...(process.env.ANDROID_SDK_ROOT?[path.join(process.env.ANDROID_SDK_ROOT,'platform-tools/adb')]:[])];
const adb=candidates.find(c=>run(c,['version']).ok);
const android=adb?run(adb,['devices','-l']):{ok:false,output:''};
const emulators=android.output.split('\n').filter(s=>/^emulator-\d+\s+device\b/.test(s)).length;
const ios=run('xcrun',['simctl','list','devices','booted','--json']);let simulators=0;
if(ios.ok){const data=JSON.parse(ios.output);simulators=Object.values(data.devices||{}).flat().filter(d=>d.state==='Booted'&&d.isAvailable).length;}
const report={generatedAt:new Date().toISOString(),scope:'Read-only prerequisites; no provider login executed',provider:configured.VITE_AUTH_PROVIDER,apiOrigin:configured.VITE_NATIVE_API_ORIGIN,issuer:configured.VITE_NEWHOPE_AUTH_URL,environment:'Existing PR29 configured native target; not PR30 staff database',android:{sdkAvailable:!!adb,bootedEmulators:emulators,status:emulators?'NOT RUN':'BLOCKED',required:'Android SDK/platform-tools, emulator system image, booted disposable emulator, configured staging APK and private test login'},ios:{simctlAvailable:ios.ok,bootedSimulators:simulators,status:simulators?'NOT RUN':'BLOCKED',required:'Full Xcode, iOS simulator runtime, booted simulator, configured App.app and private test login'},hostedAuthentication:'NOT RUN',physicalDevices:'NOT RUN',nativeFinancialCheckout:'OFF'};
fs.mkdirSync('build/native-auth-acceptance',{recursive:true});fs.writeFileSync('build/native-auth-acceptance/preflight.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!emulators||!simulators)process.exitCode=2;
