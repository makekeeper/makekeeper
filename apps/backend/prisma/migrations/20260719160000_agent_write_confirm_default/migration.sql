-- Policy rollout (#78): WRITE agent tools now default to a confirmation gate,
-- same as DESTRUCTIVE — any data-changing call must be approved by the end user.
--
-- The registry seeds a tool's confirmation policy only on its FIRST registration
-- and never rewrites an existing row (so admin overrides survive reboots). On any
-- instance that booted before this change, WRITE rows were seeded under the old
-- AUTO default and would silently keep auto-running. Bump those rows once here.
--
-- Scope: only rows still at 'AUTO' whose tool is WRITE at this point in time.
-- DESTRUCTIVE rows were already 'CONFIRM'; READ intentionally stays 'AUTO'. A tool
-- an admin had deliberately relaxed to 'AUTO' is reset to the safer default by this
-- one-time rollout — it can be relaxed again from Settings → Agent tools. New WRITE
-- tools added later seed correctly via the registry, so this list is point-in-time.
UPDATE "AgentToolConfig"
SET "confirmationPolicy" = 'CONFIRM'
WHERE "confirmationPolicy" = 'AUTO'
  AND "toolName" IN (
    'add_task',
    'adjust_component_quantity',
    'assign_tag',
    'consume_component',
    'create_component',
    'create_order',
    'create_project',
    'create_return',
    'create_storage',
    'create_supplier',
    'create_tag',
    'import_order_from_image',
    'link_component_to_project',
    'merge_storage_grid_cells',
    'move_component',
    'receive_order_items',
    'refresh_tracking',
    'reserve_component',
    'return_component',
    'split_storage_grid_cell',
    'toggle_task',
    'unassign_tag',
    'update_component',
    'update_order_status',
    'update_project',
    'update_return_status',
    'update_storage',
    'update_storage_grid',
    'update_supplier',
    'update_tag',
    'update_task'
  );
