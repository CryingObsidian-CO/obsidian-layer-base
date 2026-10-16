import { optionCssColor } from '../model/select-options';

/**
 * Draws one option as a pill: the chip used both for a select cell's value and
 * for an option row in the dropdown. The colour is handed to CSS as the custom
 * property `--layer-pill-color`, so everything painted stays in `styles.css`
 * and a theme change repaints without re-rendering.
 *
 * A colour that cannot be resolved is simply not applied; the pill then keeps
 * the neutral look `styles.css` gives it.
 *
 * The name is written into a child span rather than onto the pill itself. The
 * pill is a flex container, so bare text in it would become an anonymous flex
 * item that inherits neither `overflow` nor `text-overflow` — the pill's own
 * truncation could then only hard-clip the label, never ellipsize it. Making the
 * label its own flex item puts the truncation on the box that owns the text.
 */
export function renderOptionPill(
	parent: HTMLElement,
	name: string,
	color: string | undefined,
): HTMLElement {
	const pill = parent.createSpan({ cls: 'layer-select-pill' });
	const cssColor = optionCssColor(color);
	if (cssColor) {
		pill.addClass('has-color');
		pill.setCssProps({ '--layer-pill-color': cssColor });
	}
	pill.createSpan({ cls: 'layer-select-pill-label', text: name });
	return pill;
}
