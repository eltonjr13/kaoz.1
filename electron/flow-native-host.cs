using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class KaozFlowNativeHost
{
    private const string ExtensionOrigin = "chrome-extension://eogpaadohpepjiedfbmigenebifdlldi/";
    private static readonly object OutputLock = new object();
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static volatile bool _running = true;

    private static string RuntimePath()
    {
        string configured = Environment.GetEnvironmentVariable("KAOZ1_FLOW_NATIVE_RUNTIME_FILE");
        if (!String.IsNullOrWhiteSpace(configured)) return configured;
        string appData = Environment.GetEnvironmentVariable("APPDATA");
        if (String.IsNullOrWhiteSpace(appData)) appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return Path.Combine(appData, "Kaoz.1", "flow-companion-runtime.json");
    }

    private static IDictionary<string, object> ReadRuntime()
    {
        try
        {
            var value = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(RuntimePath(), Encoding.UTF8));
            Uri url;
            object baseUrl;
            object token;
            object pid;
            if (!value.TryGetValue("baseUrl", out baseUrl) || !Uri.TryCreate(Convert.ToString(baseUrl), UriKind.Absolute, out url)) return null;
            if (url.Scheme != "http" || url.Host != "127.0.0.1" || url.IsDefaultPort) return null;
            if (!value.TryGetValue("token", out token) || !System.Text.RegularExpressions.Regex.IsMatch(Convert.ToString(token), "^[a-f0-9]{64}$")) return null;
            if (!value.TryGetValue("pid", out pid) || Convert.ToInt32(pid) < 1) return null;
            return value;
        }
        catch { return null; }
    }

    private static void WriteMessage(object message)
    {
        byte[] payload = Encoding.UTF8.GetBytes(Json.Serialize(message));
        byte[] length = BitConverter.GetBytes(payload.Length);
        lock (OutputLock)
        {
            Stream output = Console.OpenStandardOutput();
            output.Write(length, 0, length.Length);
            output.Write(payload, 0, payload.Length);
            output.Flush();
        }
    }

    private static void ReadInput()
    {
        try
        {
            Stream input = Console.OpenStandardInput();
            byte[] header = new byte[4];
            while (_running)
            {
                int received = input.Read(header, 0, 4);
                if (received == 0) break;
                while (received < 4)
                {
                    int next = input.Read(header, received, 4 - received);
                    if (next == 0) { _running = false; return; }
                    received += next;
                }
                int size = BitConverter.ToInt32(header, 0);
                if (size < 0 || size > 1024 * 1024) break;
                byte[] payload = new byte[size];
                int offset = 0;
                while (offset < size)
                {
                    int next = input.Read(payload, offset, size - offset);
                    if (next == 0) { _running = false; return; }
                    offset += next;
                }
            }
        }
        catch { }
        _running = false;
    }

    public static int Main(string[] args)
    {
        if (args.Length == 0 || args[0] != ExtensionOrigin) return 1;
        var inputThread = new Thread(ReadInput) { IsBackground = true };
        inputThread.Start();
        string last = null;
        while (_running)
        {
            IDictionary<string, object> runtime = ReadRuntime();
            string serialized = runtime == null ? String.Empty : Json.Serialize(runtime);
            if (serialized != last)
            {
                last = serialized;
                if (runtime == null)
                {
                    WriteMessage(new { type = "unavailable", message = "Abra o Kaoz.1 para conectar a extensão." });
                }
                else
                {
                    WriteMessage(new {
                        type = "configure",
                        baseUrl = Convert.ToString(runtime["baseUrl"]),
                        token = Convert.ToString(runtime["token"]),
                        desktopPid = Convert.ToInt32(runtime["pid"])
                    });
                }
            }
            Thread.Sleep(1500);
        }
        return 0;
    }
}
