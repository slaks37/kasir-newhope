package space.newhope.kasir;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name="SecureSession")
public class SecureSessionPlugin extends Plugin {
 private static final String ALIAS="newhope.session.v1";
 private SharedPreferences store(){return getContext().getSharedPreferences(ALIAS,Context.MODE_PRIVATE);}
 private String key(PluginCall call)throws Exception{String k=call.getString("key");if(k==null||!k.matches("sb-[a-zA-Z0-9-]+-auth-token(?:-code-verifier|-user)?"))throw new Exception("INVALID_SESSION_KEY");return k;}
 private synchronized SecretKey secret()throws Exception{
  KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
  if(!ks.containsAlias(ALIAS)){KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());g.generateKey();}
  return (SecretKey)ks.getKey(ALIAS,null);
 }
 @PluginMethod public void get(PluginCall call){try{
  String k=key(call),v=store().getString(k,null);JSObject out=new JSObject();
  if(v==null)out.put("value",org.json.JSONObject.NULL);
  else{String[] p=v.split(":",2);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,secret(),new GCMParameterSpec(128,Base64.decode(p[0],Base64.NO_WRAP)));c.updateAAD(k.getBytes(StandardCharsets.UTF_8));out.put("value",new String(c.doFinal(Base64.decode(p[1],Base64.NO_WRAP)),StandardCharsets.UTF_8));}
  call.resolve(out);
 }catch(Exception e){call.reject("SECURE_SESSION_UNAVAILABLE");}}
 @PluginMethod public void set(PluginCall call){try{
  String k=key(call),v=call.getString("value");if(v==null)throw new Exception();Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,secret());c.updateAAD(k.getBytes(StandardCharsets.UTF_8));String encoded=Base64.encodeToString(c.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(c.doFinal(v.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
  if(!store().edit().putString(k,encoded).commit())throw new Exception();call.resolve();
 }catch(Exception e){call.reject("SECURE_SESSION_UNAVAILABLE");}}
 @PluginMethod public void remove(PluginCall call){try{if(!store().edit().remove(key(call)).commit())throw new Exception();call.resolve();}catch(Exception e){call.reject("SECURE_SESSION_UNAVAILABLE");}}
}
