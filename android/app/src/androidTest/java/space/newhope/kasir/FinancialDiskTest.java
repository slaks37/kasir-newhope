package space.newhope.kasir;
import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import static org.junit.Assert.*;

/** Runs the production plugin against Android SQLite, never a map or mocked database. */
@RunWith(AndroidJUnit4.class)
public class FinancialDiskTest {
 private static final String KEY="newhope_sync_queue_workspace:v2:synthetic-tenant:merchant:outlet:retail:cashier";
 private static final String VALUE="[{\"clientTxnId\":\"synthetic-sale\",\"totalAmount\":100}]";
 private FinancialDiskPlugin plugin(){final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();return new FinancialDiskPlugin(){@Override public Context getContext(){return context;}};}
 private static class Call extends PluginCall {
  JSObject result;String error;boolean resolved;
  Call(JSObject data){super(null,"FinancialDisk","test","test",data);}
  @Override public void resolve(JSObject value){result=value;resolved=true;}
  @Override public void resolve(){resolved=true;}
  @Override public void reject(String value){error=value;}
 }
 private Call write(FinancialDiskPlugin plugin,String expected,String value){JSObject args=new JSObject();args.put("key",KEY);args.put("expected",expected==null?JSONObject.NULL:expected);args.put("value",value==null?JSONObject.NULL:value);Call call=new Call(args);plugin.compareAndSet(call);return call;}
 private JSObject load(FinancialDiskPlugin plugin){Call call=new Call(new JSObject());plugin.load(call);assertNull(call.error);assertTrue(call.resolved);return call.result;}
 @Test public void prepareForProcessDeath() throws Exception {
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();context.deleteDatabase("newhope-financial-v1.db");
  FinancialDiskPlugin first=plugin();JSObject before=load(first);assertNotNull(before.getString("deviceId"));assertTrue(write(first,null,VALUE).resolved);
  FinancialDiskPlugin competitor=plugin();Call stale=write(competitor,null,"OVERWRITE");assertEquals("FINANCIAL_STORAGE_CONFLICT",stale.error);assertFalse(stale.resolved);
  assertEquals(VALUE,load(competitor).getJSONArray("entries").getJSONObject(0).getString("value"));
  context.getSharedPreferences("synthetic-recovery-evidence",0).edit().putString("deviceId",before.getString("deviceId")).commit();
  // Deliberately keep connections open; the CI script kills the app process next.
 }
 @Test public void recoverAfterProcessDeath() throws Exception {
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();FinancialDiskPlugin reopened=plugin();JSObject snapshot=load(reopened);
  String expectedDevice=context.getSharedPreferences("synthetic-recovery-evidence",0).getString("deviceId",null);assertNotNull("Prepare must run in the earlier process",expectedDevice);assertEquals(expectedDevice,snapshot.getString("deviceId"));
  assertEquals(VALUE,snapshot.getJSONArray("entries").getJSONObject(0).getString("value"));assertEquals(KEY,snapshot.getJSONArray("entries").getJSONObject(0).getString("key"));
  assertEquals("FINANCIAL_STORAGE_CONFLICT",write(reopened,"wrong acknowledgement",null).error);assertEquals(1,load(reopened).getJSONArray("entries").length());
  assertTrue(write(reopened,VALUE,null).resolved);reopened.handleOnDestroy();assertEquals(0,load(plugin()).getJSONArray("entries").length());
 }
}
