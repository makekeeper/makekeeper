export { ProjectsPluginModule } from './projects.module';
// The default group's derivation, exported for the app shell: the first-install
// demo seed (#339) writes projects directly and needs the same group every
// other write path lands in — deriving that id a second time is how two
// "General" groups appear.
export {
  defaultProjectGroupId,
  ensureDefaultProjectGroup,
} from './project-groups.util';
