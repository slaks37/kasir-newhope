import type {CapacitorConfig} from '@capacitor/cli';
const config:CapacitorConfig={
 appId:'space.newhope.kasir',appName:'New Hope',webDir:'dist-mobile',
 server:{androidScheme:'https',hostname:'localhost'},
 android:{allowMixedContent:false},
 ios:{contentInset:'automatic'},
 plugins:{CapacitorHttp:{enabled:false}},
};
export default config;
