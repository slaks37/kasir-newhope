package space.newhope.kasir;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteDatabaseCorruptException;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.UUID;
import java.util.Objects;

/** App-private SQLite WAL journal, excluded from backups by the application manifest. */
@CapacitorPlugin(name="FinancialDisk")
public class FinancialDiskPlugin extends Plugin {
 private SQLiteDatabase db;
 private synchronized SQLiteDatabase database(){
  if(db==null){
   SQLiteDatabase candidate=getContext().openOrCreateDatabase("newhope-financial-v1.db",0,null,corrupt -> {
    // Android defaults to deleting corrupt databases. Preserve financial evidence.
    throw new SQLiteDatabaseCorruptException("NATIVE_FINANCIAL_DATABASE_CORRUPT");
   });
   try {candidate.enableWriteAheadLogging();candidate.execSQL("PRAGMA synchronous=FULL");candidate.execSQL("CREATE TABLE IF NOT EXISTS journal (key TEXT PRIMARY KEY,value TEXT NOT NULL)");candidate.execSQL("CREATE TABLE IF NOT EXISTS identity (id INTEGER PRIMARY KEY CHECK(id=1),device_id TEXT NOT NULL)");candidate.execSQL("INSERT OR IGNORE INTO identity(id,device_id) VALUES(1,?)",new Object[]{UUID.randomUUID().toString()});db=candidate;}
   catch(RuntimeException error){candidate.close();throw error;}
  }return db;
 }
 @Override protected synchronized void handleOnDestroy(){if(db!=null){db.close();db=null;}}
 private boolean allowed(String k){return k!=null&&k.length()<1024&&(k.startsWith("newhope_sync_queue_workspace:v2:")||k.startsWith("newhope_sync_quarantine_workspace:v2:")||k.startsWith("newhope_cash_outbox_workspace:v2:")||k.startsWith("newhope_refund_ack_workspace:v2:")||k.startsWith("newhope_inventory_outbox_v1_workspace:v2:")||k.startsWith("newhope_shift_close_v1_"));}
 @PluginMethod public synchronized void load(PluginCall call){try{
  SQLiteDatabase d=database();JSArray entries=new JSArray();String device;
  try(Cursor c=d.rawQuery("SELECT device_id FROM identity WHERE id=1",null)){c.moveToFirst();device=c.getString(0);}
  try(Cursor c=d.rawQuery("SELECT key,value FROM journal ORDER BY key",null)){while(c.moveToNext()){JSObject row=new JSObject();row.put("key",c.getString(0));row.put("value",c.getString(1));entries.put(row);}}
  JSObject result=new JSObject();result.put("deviceId",device);result.put("entries",entries);call.resolve(result);
 }catch(Exception e){call.reject("NATIVE_FINANCIAL_STORAGE_UNAVAILABLE");}}
 @PluginMethod public synchronized void compareAndSet(PluginCall call){SQLiteDatabase d=null;try{
  String key=call.getString("key"),expected=call.getString("expected"),value=call.getString("value");if(!allowed(key))throw new Exception("INVALID_FINANCIAL_KEY");d=database();d.beginTransaction();String existing=null;
  try(Cursor c=d.rawQuery("SELECT value FROM journal WHERE key=?",new String[]{key})){if(c.moveToFirst())existing=c.getString(0);}
  if(!Objects.equals(existing,expected))throw new Exception("FINANCIAL_STORAGE_CONFLICT");
  if(value==null)d.execSQL("DELETE FROM journal WHERE key=?",new Object[]{key});else d.execSQL("INSERT OR REPLACE INTO journal(key,value) VALUES(?,?)",new Object[]{key,value});
  d.setTransactionSuccessful();d.endTransaction();d=null;call.resolve();
 }catch(Exception e){if(d!=null&&d.inTransaction())d.endTransaction();call.reject("FINANCIAL_STORAGE_CONFLICT".equals(e.getMessage())?e.getMessage():"NATIVE_FINANCIAL_STORAGE_UNAVAILABLE");}}
}
