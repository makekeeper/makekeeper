import { Injectable } from '@nestjs/common';
import { PrismaService } from '@makekeeper/backend-core';
// One shared grid-address convention for UI, tools and services — see
// plugin-contract/grid-address. The agent reads these addresses, never derives them.
import { formatCellAddress } from '@makekeeper/plugin-contract';

@Injectable()
export class StoragesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const storages = await this.prisma.storage.findMany({
      include: {
        _count: {
          select: { components: true },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    return storages.map((s) => ({
      id: s.id,
      name: s.name,
      parentId: s.parentId,
      location: s.location,
      componentsCount: s._count.components,
      gridRows: s.gridRows,
      gridCols: s.gridCols,
      parentRow: s.parentRow,
      parentCol: s.parentCol,
      // Human address of the cell this container occupies in its parent's grid.
      cellAddress: formatCellAddress(s.parentRow, s.parentCol),
      gridSpans: s.gridSpans,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  // Root→target breadcrumb for a storage, each nested hop tagged with the parent-
  // grid cell it occupies ("Office / Working Table (A2)"), plus the target's own
  // name. Shared by the page-context resolver and the ORef resolver so there is one
  // path-building convention. Returns null when the id is unknown.
  async getBreadcrumb(
    id: string,
  ): Promise<{ name: string; path: string } | null> {
    const storages = await this.findAll();
    const byId = new Map(storages.map((s) => [s.id, s]));
    const target = byId.get(id);
    if (!target) return null;
    const crumbs: string[] = [];
    let current = byId.get(id);
    // The parent chain is finite; the size guard only protects against a cyclic
    // parentId corruption in the data.
    for (let i = 0; current && i < storages.length; i++) {
      const placement = formatCellAddress(current.parentRow, current.parentCol);
      crumbs.unshift(
        placement ? `${current.name} (${placement})` : current.name,
      );
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return { name: target.name, path: crumbs.join(' / ') };
  }

  async findOne(id: string) {
    const storage = await this.prisma.storage.findUnique({
      where: { id },
      include: {
        children: true,
        components: true,
      },
    });
    if (!storage) return storage;
    // Tag each component and child with its human grid address so the agent never
    // has to (mis)compute "A1" from row/col.
    return {
      ...storage,
      components: storage.components.map((c) => ({
        ...c,
        cellAddress: formatCellAddress(c.storageRow, c.storageCol),
      })),
      children: storage.children.map((ch) => ({
        ...ch,
        cellAddress: formatCellAddress(ch.parentRow, ch.parentCol),
      })),
    };
  }

  async create(data: {
    name: string;
    parentId?: string;
    location?: string;
    gridRows?: number;
    gridCols?: number;
    parentRow?: number;
    parentCol?: number;
    gridSpans?: string;
  }) {
    const id = 'storage_' + Math.random().toString(36).substring(2, 9);
    return this.prisma.storage.create({
      data: {
        id,
        name: data.name,
        parentId: data.parentId || null,
        location: data.location || '',
        gridRows: data.gridRows ? Number(data.gridRows) : null,
        gridCols: data.gridCols ? Number(data.gridCols) : null,
        parentRow:
          data.parentRow !== undefined && data.parentRow !== null
            ? Number(data.parentRow)
            : null,
        parentCol:
          data.parentCol !== undefined && data.parentCol !== null
            ? Number(data.parentCol)
            : null,
        gridSpans: data.gridSpans || null,
      },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      parentId?: string;
      location?: string;
      gridRows?: number;
      gridCols?: number;
      parentRow?: number;
      parentCol?: number;
      gridSpans?: string;
    },
  ) {
    return this.prisma.storage.update({
      where: { id },
      data: {
        name: data.name,
        parentId:
          data.parentId === undefined ? undefined : data.parentId || null,
        location: data.location,
        gridRows:
          data.gridRows === undefined
            ? undefined
            : data.gridRows
              ? Number(data.gridRows)
              : null,
        gridCols:
          data.gridCols === undefined
            ? undefined
            : data.gridCols
              ? Number(data.gridCols)
              : null,
        parentRow:
          data.parentRow === undefined
            ? undefined
            : data.parentRow !== null
              ? Number(data.parentRow)
              : null,
        parentCol:
          data.parentCol === undefined
            ? undefined
            : data.parentCol !== null
              ? Number(data.parentCol)
              : null,
        gridSpans: data.gridSpans === undefined ? undefined : data.gridSpans,
      },
    });
  }

  async delete(id: string) {
    return this.prisma.storage.delete({
      where: { id },
    });
  }

  async getComponents(storageId: string, cell?: { row: number; col: number }) {
    const allStorages = await this.prisma.storage.findMany();

    const getDescendants = (id: string): string[] => {
      const children = allStorages.filter((s) => s.parentId === id);
      return [id, ...children.flatMap((c) => getDescendants(c.id))];
    };

    let where;
    if (cell) {
      // Cell filter: contents of ONE grid cell = components sitting directly in
      // that cell of `storageId`, plus everything inside any nested storages
      // placed there.
      const nestedIds = allStorages
        .filter(
          (s) =>
            s.parentId === storageId &&
            s.parentRow === cell.row &&
            s.parentCol === cell.col,
        )
        .flatMap((s) => getDescendants(s.id));
      where = {
        OR: [
          { storageId, storageRow: cell.row, storageCol: cell.col },
          ...(nestedIds.length ? [{ storageId: { in: nestedIds } }] : []),
        ],
      };
    } else {
      where = { storageId: { in: getDescendants(storageId) } };
    }

    const components = await this.prisma.component.findMany({
      where,
      include: { storage: true },
      orderBy: { name: 'asc' },
    });
    // Tag each component with its human grid address so the agent reads it instead
    // of computing (and mislabelling) it from row/col.
    return components.map((c) => ({
      ...c,
      cellAddress: formatCellAddress(c.storageRow, c.storageCol),
    }));
  }
}
