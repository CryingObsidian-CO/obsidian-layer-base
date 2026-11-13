import { optionCssColor } from '../model/select-options';

/**
 * The label gets its own span: bare text in the flex container becomes an anonymous
 * item, so the pill's own truncation could only hard-clip it, never ellipsize.
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
