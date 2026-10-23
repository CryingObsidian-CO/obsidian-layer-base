import type { SummaryKind } from '../model/summary';
import { t } from '../i18n';

/**
 * How a summary reads in the menu and in the footer tooltip.
 *
 * The mapping lives beside the UI rather than in the model because the engine keeps
 * to data and takes no dependency on translations.
 */
export function summaryLabel(kind: SummaryKind): string {
	switch (kind) {
		case 'none':
			return t().summaryNone;
		case 'filled':
			return t().summaryFilled;
		case 'empty':
			return t().summaryEmpty;
		case 'unique':
			return t().summaryUnique;
		case 'sum':
			return t().summarySum;
		case 'average':
			return t().summaryAverage;
		case 'min':
			return t().summaryMin;
		case 'max':
			return t().summaryMax;
		case 'earliest':
			return t().summaryEarliest;
		case 'latest':
			return t().summaryLatest;
		case 'range':
			return t().summaryRange;
	}
}