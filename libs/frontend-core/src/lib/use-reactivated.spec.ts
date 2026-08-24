import { defineComponent, h, KeepAlive, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { onReactivated } from './use-reactivated';

// The whole point of this helper is the case every hand-rolled version gets
// wrong: Vue fires `activated` on the FIRST mount too, right after `onMounted`
// has already loaded the data — so a naive `onActivated(load)` double-fetches
// on arrival and looks like it works.

const Pane = defineComponent({
  props: { onRefetch: { type: Function, required: true } },
  setup(props) {
    onReactivated(() => props.onRefetch());
    return () => h('p', 'pane');
  },
});

const render = (onRefetch: () => void) => {
  const shown = ref(true);
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(KeepAlive, null, {
          default: () => (shown.value ? h(Pane, { onRefetch }) : h('span')),
        }),
    }),
  );
  return { wrapper, shown };
};

describe('onReactivated', () => {
  it('does not fire on the first activation', () => {
    const refetch = vi.fn();
    render(refetch);
    expect(refetch).not.toHaveBeenCalled();
  });

  it('fires every time the component comes back', async () => {
    const refetch = vi.fn();
    const { wrapper, shown } = render(refetch);

    shown.value = false;
    await wrapper.vm.$nextTick();
    expect(refetch).not.toHaveBeenCalled();

    shown.value = true;
    await wrapper.vm.$nextTick();
    expect(refetch).toHaveBeenCalledTimes(1);

    shown.value = false;
    await wrapper.vm.$nextTick();
    shown.value = true;
    await wrapper.vm.$nextTick();
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
