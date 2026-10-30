using System.Text;
using System.Text.Json;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Assets;

/// <summary>Material description exported from a Three.js material (colours are linear).</summary>
public sealed class MaterialData
{
    public string Name { get; set; }
    public string Type { get; set; }
    public float[] Color { get; set; }
    public float Opacity { get; set; } = 1;
    public bool Transparent { get; set; }
    public float AlphaTest { get; set; }
    public int Side { get; set; }
    public bool DepthWrite { get; set; } = true;
    public bool Additive { get; set; }
    public bool VertexColors { get; set; }
    public float Roughness { get; set; } = 1;
    public float Metalness { get; set; }
    public float EnvMapIntensity { get; set; } = 1;
    public bool FlatShading { get; set; }
    public float[] Emissive { get; set; }
    public string Map { get; set; }
    public string NormalMap { get; set; }
    public float[] NormalScale { get; set; }
    public string EmissiveMap { get; set; }
    public bool ToneMapped { get; set; } = true;
    public VoxelData Voxel { get; set; }
    public TileData Tile { get; set; }
    public float ScrollV { get; set; }
}

public sealed class VoxelData
{
    public float Size { get; set; }
    public float Jitter { get; set; }
    public float Seam { get; set; }
}

public sealed class TileData
{
    public float[] Origin { get; set; }
    public float Size { get; set; }
    public float Grout { get; set; }
    public float[] GroutColor { get; set; }
    public float Crop { get; set; }
    public float ImageAspect { get; set; }
}

public sealed class MeshPartData
{
    public int Material { get; set; }
    public int VertexStart { get; set; }
    public int VertexCount { get; set; }
    public int IndexStart { get; set; }
    public int IndexCount { get; set; }
}

/// <summary>Vertex as stored in .bpm files and uploaded to the GPU (36 bytes).</summary>
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential, Pack = 1)]
public struct MeshVertex
{
    public Vector3 Position;
    public Vector3 Normal;
    public Vector2 Uv;
    public Color Color;
}

/// <summary>
/// Per-instance vertex (64 bytes): rows of a 4x3 matrix + linear RGBA colour (may exceed 1 for
/// HDR flashes). Same layout in .bpi files and in the GPU instance buffers.
/// </summary>
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential, Pack = 1)]
public struct InstanceVertex
{
    public Vector3 Row0;
    public Vector3 Row1;
    public Vector3 Row2;
    public Vector3 Row3;
    public Vector4 Color;

    public static InstanceVertex From(in Matrix m, Vector4 color) => new()
    {
        Row0 = new Vector3(m.M11, m.M12, m.M13),
        Row1 = new Vector3(m.M21, m.M22, m.M23),
        Row2 = new Vector3(m.M31, m.M32, m.M33),
        Row3 = new Vector3(m.M41, m.M42, m.M43),
        Color = color,
    };

    /// <summary>A collapsed (invisible) instance.</summary>
    public static readonly InstanceVertex Hidden = default;
}

/// <summary>CPU-side mesh read from a .bpm file (see tools/monogame-export/exporter.js).</summary>
public sealed class MeshFile
{
    public List<MaterialData> Materials { get; private set; }
    public List<MeshPartData> Parts { get; private set; }
    public BoundingBox? Bounds { get; private set; }
    public MeshVertex[] Vertices { get; private set; }
    public ushort[] Indices { get; private set; }

    private sealed class Header
    {
        public List<MaterialData> Materials { get; set; }
        public List<MeshPartData> Parts { get; set; }
        public BoundsData Bounds { get; set; }
    }

    private sealed class BoundsData
    {
        public float[] Min { get; set; }
        public float[] Max { get; set; }
    }

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public static MeshFile Read(BinaryReader r)
    {
        Expect(r, "BPM1");
        var header = JsonSerializer.Deserialize<Header>(Encoding.UTF8.GetString(r.ReadBytes(r.ReadInt32())), Json);
        var mesh = new MeshFile
        {
            Materials = header.Materials ?? new List<MaterialData>(),
            Parts = header.Parts ?? new List<MeshPartData>(),
            Bounds = header.Bounds?.Min == null ? null : new BoundingBox(ToV3(header.Bounds.Min), ToV3(header.Bounds.Max)),
        };
        var vertexCount = r.ReadInt32();
        var vertexBytes = r.ReadBytes(vertexCount * 36);
        mesh.Vertices = new MeshVertex[vertexCount];
        System.Runtime.InteropServices.MemoryMarshal.Cast<byte, MeshVertex>(vertexBytes).CopyTo(mesh.Vertices);
        var indexCount = r.ReadInt32();
        var indexBytes = r.ReadBytes(indexCount * 2);
        mesh.Indices = new ushort[indexCount];
        System.Runtime.InteropServices.MemoryMarshal.Cast<byte, ushort>(indexBytes).CopyTo(mesh.Indices);
        return mesh;
    }

    internal static void Expect(BinaryReader r, string magic)
    {
        var m = Encoding.ASCII.GetString(r.ReadBytes(4));
        if (m != magic) throw new InvalidDataException($"Expected {magic}, got {m}");
    }

    internal static Vector3 ToV3(float[] a) => new(a[0], a[1], a[2]);
}

/// <summary>Instanced mesh read from a .bpi file: template mesh + per-instance transforms.</summary>
public sealed class InstanceFile
{
    public Matrix MeshMatrix { get; private set; }
    public InstanceVertex[] Instances { get; private set; }
    public MeshFile Template { get; private set; }

    private sealed class Header
    {
        public float[] MeshMatrix { get; set; }
        public int Count { get; set; }
    }

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public static InstanceFile Read(BinaryReader r)
    {
        MeshFile.Expect(r, "BPI1");
        var header = JsonSerializer.Deserialize<Header>(Encoding.UTF8.GetString(r.ReadBytes(r.ReadInt32())), Json);
        var count = r.ReadInt32();
        var bytes = r.ReadBytes(count * 64);
        var instances = new InstanceVertex[count];
        System.Runtime.InteropServices.MemoryMarshal.Cast<byte, InstanceVertex>(bytes).CopyTo(instances);
        return new InstanceFile
        {
            MeshMatrix = Core.MathX.FromThree(header.MeshMatrix),
            Instances = instances,
            Template = MeshFile.Read(r),
        };
    }
}
