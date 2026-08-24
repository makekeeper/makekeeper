import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h } from 'vue';
import PageHeader from './PageHeader.vue';
import { registerPlugin } from '../registry';

// A stub contribution for the page.header.actions slot that echoes the entityRef
// it receives, so we can assert both that it renders and that PageHeader passed
// the context ref through the slot ctx.
const ExportStub = defineComponent({
  props: { entityRef: { type: String, default: undefined } },
  setup: (props) => () =>
    h('button', { class: 'export-stub' }, props.entityRef ?? 'no-ref'),
});

registerPlugin({
  id: 'header-actions-test',
  nameKey: 'plugins.test.name',
  navigation: [],
  routes: [],
  messages: {},
  contributions: [{ slot: 'page.header.actions', component: ExportStub }],
});

const IconStub = defineComponent({ template: '<svg class="the-icon" />' });

const mountHeader = (props: Record<string, unknown>, slots = {}) =>
  mount(PageHeader, {
    props,
    slots,
    global: { plugins: [createPinia()] },
  });

describe('PageHeader', () => {
  it('renders the title, subtitle and icon', () => {
    const wrapper = mountHeader({
      title: 'Inventory',
      subtitle: 'Track parts',
      icon: IconStub,
    });
    expect(wrapper.get('h2').text()).toBe('Inventory');
    expect(wrapper.get('p').text()).toBe('Track parts');
    expect(wrapper.find('.the-icon').exists()).toBe(true);
  });

  it('renders the #actions slot in the right-aligned actions cluster', () => {
    const wrapper = mountHeader(
      { title: 'Storages' },
      { actions: '<span class="page-action">Add</span>' },
    );
    const cluster = wrapper.get('.gap-2');
    expect(cluster.find('.page-action').exists()).toBe(true);
  });

  it('renders the page.header.actions slot and passes contextRef as entityRef', () => {
    const wrapper = mountHeader({
      title: 'Project',
      contextRef: 'mk://projects/project/p1',
    });
    const stub = wrapper.get('.export-stub');
    expect(stub.text()).toBe('mk://projects/project/p1');
  });

  it('omits the actions cluster when there is no contextRef and no #actions slot', () => {
    const wrapper = mountHeader({ title: 'Bare' });
    expect(wrapper.find('.gap-2').exists()).toBe(false);
    expect(wrapper.find('.export-stub').exists()).toBe(false);
  });
});
