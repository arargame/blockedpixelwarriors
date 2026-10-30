using System.Text;
using System.Text.RegularExpressions;

// -------------------------------------------------------------------------------------------------
// EffectPacker: GLSL (.glfx) -> MonoGame MGFX (OpenGL profile, version 10).
//
// A .glfx file is plain GLSL ES 1.00 (also valid desktop GLSL 1.10) split into sections, plus a
// few directives that describe what MonoGame needs to know (parameters, samplers, attributes,
// techniques). The packer generates the uniform arrays MonoGame uploads ("vs_uniforms_vec4" /
// "ps_uniforms_vec4"), #defines that map every parameter name onto its slot, the GLES precision
// header and MonoGame's "posFixup" vertex fix (render-target flip + half-pixel offset).
//
// Directives (one per line, anywhere outside a section):
//   @uniform vs|ps|both float|vec2|vec3|vec4|mat4 Name     effect parameter (mat4: use  v * M)
//   @sampler Name Slot                                     sampler2D uniform + Texture2D parameter
//   @attribute name USAGE index                            e.g.  @attribute a_pos POSITION 0
//   @technique Name vs=section ps=section [blend=...] [depth=...] [cull=...]
//   @define NAME [value]                                   #define added to every stage (variants)
// Sections: #common (all stages), #pscommon (prepended to every #ps section), #vs Name, #ps Name.
// Sections:
//   #common        code shared by all stages (functions, varyings)
//   #vs Name       a vertex shader  (write a normal  void main() )
//   #ps Name       a pixel shader   (write a normal  void main() )
// Variants: run with  --define MOBILE  to compile the same source with extra #defines.
// -------------------------------------------------------------------------------------------------

if (args.Length < 2)
{
    Console.Error.WriteLine("usage: EffectPacker <sourceDir|file.glfx> <outDir> [--define NAME[=VALUE]]...");
    return 1;
}

var defines = new List<string>();
for (var i = 2; i < args.Length; i++)
{
    if (args[i] == "--dump" && i + 1 < args.Length)
    {
        // Writes every generated GLSL stage to <dir> (validation with tools/glsl-validate.mjs).
        MgfxWriter.DumpDir = args[++i];
        Directory.CreateDirectory(MgfxWriter.DumpDir);
    }
    else if (args[i] == "--define" && i + 1 < args.Length)
    {
        var d = args[++i].Split('=', 2);
        defines.Add(d.Length == 2 ? $"#define {d[0]} {d[1]}" : $"#define {d[0]}");
    }
}

var inputs = Directory.Exists(args[0]) ? Directory.GetFiles(args[0], "*.glfx") : new[] { args[0] };
Directory.CreateDirectory(args[1]);
var failed = 0;
foreach (var path in inputs.OrderBy(p => p))
{
    try
    {
        var fx = GlfxFile.Parse(File.ReadAllText(path), defines);
        MgfxWriter.DumpPrefix = Path.GetFileNameWithoutExtension(path);
        var bytes = MgfxWriter.Write(fx);
        var outPath = Path.Combine(args[1], Path.GetFileNameWithoutExtension(path) + ".mgfx");
        File.WriteAllBytes(outPath, bytes);
        Console.WriteLine($"packed {Path.GetFileName(path)} -> {outPath} ({bytes.Length} bytes, {fx.Techniques.Count} technique(s))");
    }
    catch (Exception e)
    {
        failed++;
        Console.Error.WriteLine($"{path}: {e.Message}");
    }
}
return failed == 0 ? 0 : 2;

/// <summary>Effect parameter (uniform or texture).</summary>
internal sealed record Param(string Name, string Type, bool Vs, bool Ps, int Slot);

internal sealed record Attribute(string Name, byte Usage, byte Index);

internal sealed record Pass(string Name, string Vs, string Ps, PassStates States);

internal sealed record PassStates(string? Blend, string? Depth, string? Cull);

internal sealed class GlfxFile
{
    public List<Param> Uniforms { get; } = new();
    public List<Param> Samplers { get; } = new();
    public List<Attribute> Attributes { get; } = new();
    public List<Pass> Techniques { get; } = new();
    public List<string> Defines { get; } = new();
    public string Common { get; private set; } = "";
    public Dictionary<string, string> VertexSections { get; } = new();
    public Dictionary<string, string> PixelSections { get; } = new();

    private static readonly Dictionary<string, byte> Usages = new(StringComparer.OrdinalIgnoreCase)
    {
        ["POSITION"] = 0, ["COLOR"] = 1, ["TEXCOORD"] = 2, ["TEXTURECOORDINATE"] = 2, ["NORMAL"] = 3,
        ["BINORMAL"] = 4, ["TANGENT"] = 5, ["BLENDINDICES"] = 6, ["BLENDWEIGHT"] = 7, ["DEPTH"] = 8,
        ["FOG"] = 9, ["POINTSIZE"] = 10, ["SAMPLE"] = 11, ["TESSELATEFACTOR"] = 12,
    };

    public static GlfxFile Parse(string text, IEnumerable<string> extraDefines)
    {
        var fx = new GlfxFile();
        fx.Defines.AddRange(extraDefines);
        var common = new StringBuilder();
        var psCommon = new StringBuilder();
        StringBuilder? current = common;
        string? sectionName = null;
        var sectionIsVs = false;

        void Close()
        {
            if (sectionName == null || current == null) return;
            (sectionIsVs ? fx.VertexSections : fx.PixelSections)[sectionName] = current.ToString();
        }

        var lineNo = 0;
        foreach (var raw in text.Replace("\r\n", "\n").Split('\n'))
        {
            lineNo++;
            var line = raw.Trim();
            if (line.StartsWith('@'))
            {
                var parts = Regex.Split(line, @"\s+");
                switch (parts[0])
                {
                    case "@uniform":
                        Expect(parts.Length == 4, lineNo, "@uniform vs|ps|both type Name");
                        var stage = parts[1];
                        fx.Uniforms.Add(new Param(parts[3], parts[2], stage is "vs" or "both", stage is "ps" or "both", -1));
                        break;
                    case "@sampler":
                        Expect(parts.Length == 3, lineNo, "@sampler Name Slot");
                        fx.Samplers.Add(new Param(parts[1], "sampler2D", true, true, int.Parse(parts[2])));
                        break;
                    case "@attribute":
                        Expect(parts.Length == 4 && Usages.ContainsKey(parts[2]), lineNo, "@attribute name USAGE index");
                        fx.Attributes.Add(new Attribute(parts[1], Usages[parts[2]], byte.Parse(parts[3])));
                        break;
                    case "@technique":
                        Expect(parts.Length >= 4, lineNo, "@technique Name vs=a ps=b");
                        var kv = parts.Skip(2).Select(p => p.Split('=', 2)).ToDictionary(p => p[0], p => p.Length > 1 ? p[1] : "");
                        fx.Techniques.Add(new Pass(parts[1], kv["vs"], kv["ps"], new PassStates(kv.GetValueOrDefault("blend"), kv.GetValueOrDefault("depth"), kv.GetValueOrDefault("cull"))));
                        break;
                    case "@define":
                        fx.Defines.Add("#define " + string.Join(' ', parts.Skip(1)));
                        break;
                    default:
                        throw new FormatException($"line {lineNo}: unknown directive {parts[0]}");
                }
                continue;
            }
            if (line.StartsWith("#vs ") || line.StartsWith("#ps ") || line == "#common" || line == "#pscommon")
            {
                Close();
                if (line == "#common")
                {
                    sectionName = null;
                    current = common;
                }
                else if (line == "#pscommon")
                {
                    // Code shared by every pixel section (lighting functions using ps uniforms).
                    sectionName = null;
                    current = psCommon;
                    current.Append("#line ").Append(lineNo + 1).Append('\n');
                }
                else
                {
                    sectionIsVs = line.StartsWith("#vs");
                    sectionName = line[4..].Trim();
                    current = new StringBuilder();
                    current.Append("#line ").Append(lineNo + 1).Append('\n');
                }
                continue;
            }
            current!.Append(raw).Append('\n');
        }
        Close();
        if (psCommon.Length > 0)
            foreach (var key in fx.PixelSections.Keys.ToList())
                fx.PixelSections[key] = psCommon + fx.PixelSections[key];
        fx.Common = common.ToString();
        if (fx.Techniques.Count == 0) throw new FormatException("no @technique");
        foreach (var t in fx.Techniques)
        {
            if (!fx.VertexSections.ContainsKey(t.Vs)) throw new FormatException($"technique {t.Name}: missing #vs {t.Vs}");
            if (!fx.PixelSections.ContainsKey(t.Ps)) throw new FormatException($"technique {t.Name}: missing #ps {t.Ps}");
        }
        return fx;
    }

    private static void Expect(bool ok, int line, string usage)
    {
        if (!ok) throw new FormatException($"line {line}: expected {usage}");
    }
}

internal static class MgfxWriter
{
    private const int Version = 10;
    private const byte ProfileOpenGL = 0;

    // EffectParameterClass / EffectParameterType (MonoGame enums).
    private const byte ClassScalar = 0, ClassVector = 1, ClassMatrix = 2, ClassObject = 3;
    private const byte TypeSingle = 3, TypeTexture2D = 7;

    private static int SlotsOf(string type) => type == "mat4" ? 4 : 1;

    private sealed class Stage
    {
        public required bool IsVertex;
        public required string Source;
        public required List<(Param Param, int Offset)> Members;
        public required int CBufferIndex;  // -1 when the stage has no uniforms
        public required List<Param> Samplers;
        public required List<Attribute> Attributes;
    }

    public static string DumpDir;
    public static string DumpPrefix = "";

    public static byte[] Write(GlfxFile fx)
    {
        // Parameter table: uniforms first, then textures.
        var parameters = fx.Uniforms.Concat(fx.Samplers).ToList();
        int IndexOf(Param p) => parameters.IndexOf(p);

        // One constant buffer per stage kind, holding every uniform that stage declares.
        var vsMembers = Layout(fx.Uniforms.Where(u => u.Vs));
        var psMembers = Layout(fx.Uniforms.Where(u => u.Ps));
        var cbuffers = new List<(string Name, List<(Param Param, int Offset)> Members)>();
        var vsCb = -1;
        var psCb = -1;
        if (vsMembers.Count > 0) { vsCb = cbuffers.Count; cbuffers.Add(("vs_uniforms_vec4", vsMembers)); }
        if (psMembers.Count > 0) { psCb = cbuffers.Count; cbuffers.Add(("ps_uniforms_vec4", psMembers)); }

        // Build the shader stages actually used by techniques (each section compiled once).
        var stages = new List<Stage>();
        var stageIndex = new Dictionary<string, int>();
        int GetStage(string name, bool vertex)
        {
            var key = (vertex ? "vs:" : "ps:") + name;
            if (stageIndex.TryGetValue(key, out var idx)) return idx;
            var body = vertex ? fx.VertexSections[name] : fx.PixelSections[name];
            var members = vertex ? vsMembers : psMembers;
            var samplers = fx.Samplers.Where(s => Uses(fx.Common + body, s.Name)).ToList();
            var attributes = vertex ? fx.Attributes.Where(a => Uses(fx.Common + body, a.Name)).ToList() : new List<Attribute>();
            var src = BuildGlsl(fx, body, vertex, members, samplers, attributes);
            if (DumpDir != null) File.WriteAllText(Path.Combine(DumpDir, $"{DumpPrefix}.{name}.{(vertex ? "vert" : "frag")}"), src);
            stages.Add(new Stage
            {
                IsVertex = vertex, Source = src, Members = members, CBufferIndex = vertex ? vsCb : psCb,
                Samplers = samplers, Attributes = attributes,
            });
            stageIndex[key] = stages.Count - 1;
            return stages.Count - 1;
        }
        var passes = fx.Techniques.Select(t => (t, vs: GetStage(t.Vs, true), ps: GetStage(t.Ps, false))).ToList();

        using var body = new MemoryStream();
        using (var w = new BinaryWriter(body, Encoding.UTF8, leaveOpen: true))
        {
            // Constant buffers.
            w.Write(cbuffers.Count);
            foreach (var (name, members) in cbuffers)
            {
                w.Write(name);
                w.Write((ushort)(members.Sum(m => SlotsOf(m.Param.Type)) * 16));
                w.Write(members.Count);
                foreach (var (param, offset) in members)
                {
                    w.Write(IndexOf(param));
                    w.Write((ushort)(offset * 16));
                }
            }

            // Shaders.
            w.Write(stages.Count);
            foreach (var s in stages)
            {
                w.Write(s.IsVertex);
                var code = Encoding.ASCII.GetBytes(s.Source);
                w.Write(code.Length);
                w.Write(code);
                w.Write((byte)s.Samplers.Count);
                foreach (var smp in s.Samplers)
                {
                    w.Write((byte)0);              // SamplerType.Sampler2D
                    w.Write((byte)smp.Slot);       // texture slot
                    w.Write((byte)smp.Slot);       // sampler slot
                    w.Write(false);                // no baked sampler state: set GraphicsDevice.SamplerStates[slot]
                    w.Write(smp.Name);             // GLSL uniform name
                    w.Write((byte)IndexOf(smp));   // parameter index
                }
                if (s.CBufferIndex >= 0)
                {
                    w.Write((byte)1);
                    w.Write((byte)s.CBufferIndex);
                }
                else
                {
                    w.Write((byte)0);
                }
                w.Write((byte)s.Attributes.Count);
                foreach (var a in s.Attributes)
                {
                    w.Write(a.Name);
                    w.Write(a.Usage);
                    w.Write(a.Index);
                    w.Write((short)0);
                }
            }

            // Parameters.
            w.Write(parameters.Count);
            foreach (var p in parameters)
            {
                if (p.Type == "sampler2D")
                {
                    w.Write(ClassObject);
                    w.Write(TypeTexture2D);
                    w.Write(p.Name);
                    w.Write("");      // semantic
                    w.Write(0);       // annotations
                    w.Write((byte)0); // rows
                    w.Write((byte)0); // columns
                    w.Write(0);       // elements
                    w.Write(0);       // struct members
                    continue;
                }
                var (cls, rows, cols) = p.Type switch
                {
                    "float" => (ClassScalar, 1, 1),
                    "vec2" => (ClassVector, 1, 2),
                    "vec3" => (ClassVector, 1, 3),
                    "vec4" => (ClassVector, 1, 4),
                    "mat4" => (ClassMatrix, 4, 4),
                    _ => throw new FormatException($"unsupported uniform type {p.Type} ({p.Name})"),
                };
                w.Write(cls);
                w.Write(TypeSingle);
                w.Write(p.Name);
                w.Write("");
                w.Write(0);
                w.Write((byte)rows);
                w.Write((byte)cols);
                w.Write(0);
                w.Write(0);
                for (var i = 0; i < rows * cols; i++) w.Write(0f);
            }

            // Techniques: one pass each.
            w.Write(passes.Count);
            foreach (var (t, vs, ps) in passes)
            {
                w.Write(t.Name);
                w.Write(0);         // annotations
                w.Write(1);         // pass count
                w.Write("P0");
                w.Write(0);
                w.Write(vs);
                w.Write(ps);
                w.Write(false);     // blend / depth / raster states are set from code
                w.Write(false);
                w.Write(false);
            }
        }

        var bodyBytes = body.ToArray();
        using var outStream = new MemoryStream();
        using var o = new BinaryWriter(outStream);
        o.Write("MGFX".ToCharArray());
        o.Write((byte)Version);
        o.Write(ProfileOpenGL);
        o.Write(ComputeHash(bodyBytes));
        o.Write(bodyBytes);
        o.Write("MGFX".ToCharArray());
        return outStream.ToArray();
    }

    private static List<(Param, int)> Layout(IEnumerable<Param> uniforms)
    {
        var list = new List<(Param, int)>();
        var slot = 0;
        foreach (var u in uniforms)
        {
            list.Add((u, slot));
            slot += SlotsOf(u.Type);
        }
        return list;
    }

    private static bool Uses(string code, string name) => Regex.IsMatch(code, $@"\b{Regex.Escape(name)}\b");

    private static string BuildGlsl(GlfxFile fx, string body, bool vertex, List<(Param Param, int Offset)> members, List<Param> samplers, List<Attribute> attributes)
    {
        var sb = new StringBuilder();
        // MonoGame strips nothing: this is the exact source handed to glShaderSource.
        if (!vertex && (Uses(fx.Common + body, "dFdx") || Uses(fx.Common + body, "dFdy")))
            sb.Append("#ifdef GL_ES\n#extension GL_OES_standard_derivatives : enable\n#endif\n");
        sb.Append("#ifdef GL_ES\n");
        // Fragment shaders use highp where the GPU has it (world positions, shadow depth).
        sb.Append(vertex ? "precision highp float;\n" : "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n");
        sb.Append("precision mediump int;\n#endif\n");
        foreach (var d in fx.Defines) sb.Append(d).Append('\n');
        var array = vertex ? "vs_uniforms_vec4" : "ps_uniforms_vec4";
        var slots = members.Sum(m => SlotsOf(m.Param.Type));
        if (slots > 0) sb.Append($"uniform vec4 {array}[{slots}];\n");
        foreach (var (p, off) in members)
        {
            var expr = p.Type switch
            {
                "float" => $"{array}[{off}].x",
                "vec2" => $"{array}[{off}].xy",
                "vec3" => $"{array}[{off}].xyz",
                "vec4" => $"{array}[{off}]",
                "mat4" => $"mat4({array}[{off}], {array}[{off + 1}], {array}[{off + 2}], {array}[{off + 3}])",
                _ => throw new FormatException(p.Type),
            };
            sb.Append($"#define {p.Name} ({expr})\n");
        }
        foreach (var s in samplers) sb.Append($"uniform sampler2D {s.Name};\n");
        if (vertex)
        {
            foreach (var a in attributes) sb.Append($"attribute vec4 {a.Name};\n");
            sb.Append("uniform vec4 posFixup;\n");
        }
        sb.Append(fx.Common).Append('\n');
        if (vertex)
        {
            // Wrap the author's main() with MonoGame's GL position fix (offscreen flip + half pixel).
            sb.Append(Regex.Replace(body, @"\bvoid\s+main\s*\(\s*\)", "void bpw_main()"));
            sb.Append("\nvoid main()\n{\n  bpw_main();\n  gl_Position.y = gl_Position.y * posFixup.y;\n  gl_Position.xy += posFixup.zw * gl_Position.ww;\n  gl_Position.z = gl_Position.z * 2.0 - gl_Position.w;\n}\n");
        }
        else
        {
            sb.Append(body);
        }
        return sb.ToString();
    }

    // Same hash as MonoGame's effect compiler (only used as the effect cache key).
    private static int ComputeHash(byte[] data)
    {
        unchecked
        {
            const int p = 16777619;
            var hash = (int)2166136261;
            foreach (var b in data) hash = (hash ^ b) * p;
            hash += hash << 13;
            hash ^= hash >> 7;
            hash += hash << 3;
            hash ^= hash >> 17;
            hash += hash << 5;
            return hash;
        }
    }
}
