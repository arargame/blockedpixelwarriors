using BlockedPixelWarriors.Assets;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Rendering;

/// <summary>One material range of a <see cref="GpuMesh"/> (indices relative to BaseVertex).</summary>
public sealed class MeshPart
{
    public RenderMaterial Material;
    public int BaseVertex;
    public int StartIndex;
    public int PrimitiveCount;
}

/// <summary>Static mesh on the GPU: one vertex/index buffer pair shared by every part.</summary>
public sealed class GpuMesh : IDisposable
{
    public VertexBuffer Vertices { get; }
    public IndexBuffer Indices { get; }
    public IReadOnlyList<MeshPart> Parts { get; }
    public BoundingBox Bounds { get; }
    public string Name { get; }

    private GpuMesh(string name, VertexBuffer vb, IndexBuffer ib, List<MeshPart> parts, BoundingBox bounds)
    {
        Name = name;
        Vertices = vb;
        Indices = ib;
        Parts = parts;
        Bounds = bounds;
    }

    public static GpuMesh Create(GraphicsDevice device, string name, MeshFile file, Func<MaterialData, RenderMaterial> material)
    {
        if (file.Vertices.Length == 0) return null;
        var vb = new VertexBuffer(device, VertexFormats.Mesh, file.Vertices.Length, BufferUsage.WriteOnly);
        vb.SetData(file.Vertices);
        var ib = new IndexBuffer(device, IndexElementSize.SixteenBits, file.Indices.Length, BufferUsage.WriteOnly);
        ib.SetData(file.Indices);
        var materials = file.Materials.Select(material).ToList();
        var parts = file.Parts.Where(p => p.IndexCount > 0).Select(p => new MeshPart
        {
            Material = materials[p.Material],
            BaseVertex = p.VertexStart,
            StartIndex = p.IndexStart,
            PrimitiveCount = p.IndexCount / 3,
        }).ToList();
        var bounds = file.Bounds ?? BoundingBox.CreateFromPoints(file.Vertices.Select(v => v.Position));
        return new GpuMesh(name, vb, ib, parts, bounds);
    }

    /// <summary>The first material (single-material meshes such as blocks).</summary>
    public RenderMaterial Material => Parts.Count > 0 ? Parts[0].Material : null;

    public void Dispose()
    {
        Vertices.Dispose();
        Indices.Dispose();
    }
}

/// <summary>
/// Per-instance transforms for hardware instancing. Static sets (islands, pines, sleepers) are
/// uploaded once; dynamic sets (blocks, debris, projectiles) are refilled each frame.
/// </summary>
public sealed class InstanceBuffer : IDisposable
{
    private readonly GraphicsDevice _device;
    private VertexBuffer _buffer;
    private readonly bool _dynamic;
    public InstanceVertex[] Data { get; private set; }
    public int Count { get; set; }
    public int Capacity => Data.Length;
    public VertexBuffer Buffer => _buffer;

    public InstanceBuffer(GraphicsDevice device, int capacity, bool dynamic)
    {
        _device = device;
        _dynamic = dynamic;
        Data = new InstanceVertex[Math.Max(1, capacity)];
        _buffer = dynamic
            ? new DynamicVertexBuffer(device, VertexFormats.Instance, Data.Length, BufferUsage.WriteOnly)
            : new VertexBuffer(device, VertexFormats.Instance, Data.Length, BufferUsage.WriteOnly);
    }

    public static InstanceBuffer FromStatic(GraphicsDevice device, InstanceVertex[] instances)
    {
        var b = new InstanceBuffer(device, instances.Length, false);
        Array.Copy(instances, b.Data, instances.Length);
        b.Count = instances.Length;
        b.Upload();
        return b;
    }

    /// <summary>Appends one instance (ignored when full).</summary>
    public void Add(in Matrix m, Vector4 color)
    {
        if (Count >= Data.Length) return;
        Data[Count++] = InstanceVertex.From(m, color);
    }

    public void Upload()
    {
        if (Count == 0) return;
        if (_buffer is DynamicVertexBuffer d) d.SetData(Data, 0, Count, SetDataOptions.Discard);
        else _buffer.SetData(Data, 0, Count);
    }

    public void Dispose() => _buffer.Dispose();
}
