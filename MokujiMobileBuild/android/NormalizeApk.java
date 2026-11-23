import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.Enumeration;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

public final class NormalizeApk {
    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("Usage: NormalizeApk <input.apk> <output.apk>");
            System.exit(1);
        }
        try (ZipFile zip = new ZipFile(args[0]);
             ZipOutputStream out = new ZipOutputStream(new FileOutputStream(args[1]))) {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            byte[] buf = new byte[16384];
            while (entries.hasMoreElements()) {
                ZipEntry src = entries.nextElement();
                if (src.isDirectory()) continue;
                String name = src.getName().replace('\\', '/');
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                try (InputStream in = zip.getInputStream(src)) {
                    int n;
                    while ((n = in.read(buf)) > 0) baos.write(buf, 0, n);
                }
                byte[] data = baos.toByteArray();
                boolean store = "resources.arsc".equals(name) || name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".webp");
                ZipEntry dst = new ZipEntry(name);
                if (store) {
                    CRC32 crc = new CRC32();
                    crc.update(data);
                    dst.setMethod(ZipEntry.STORED);
                    dst.setSize(data.length);
                    dst.setCompressedSize(data.length);
                    dst.setCrc(crc.getValue());
                } else {
                    dst.setMethod(ZipEntry.DEFLATED);
                }
                out.putNextEntry(dst);
                out.write(data);
                out.closeEntry();
            }
        }
    }
}
