/**
 * Test-only stand-in for `@deepseek-ai/schemastery`.
 *
 * It implements the chainable builder subset the plugin's `Config` uses plus the
 * `~standard` validation hook the Loader looks for, so a suite can prove the
 * schema is constructed correctly even when the real library is absent.
 *
 * @module dsh-transcode-tty/test/stub-schemastery
 */

/**
 * A schema node carrying the builder metadata.
 */
class Schema {
	/**
	 * @param {'object' | 'array' | 'string' | 'number' | 'boolean'} kind - node kind.
	 * @param {object} [meta] - accumulated builder metadata.
	 */
	constructor(kind, meta = {}) {
		this.kind = kind;
		this.meta = meta;
	}

	/**
	 * Attach a default value.
	 * @param {unknown} value - the default.
	 * @returns {Schema} a new node.
	 */
	default(value) {
		return new Schema(this.kind, { ...this.meta, default: value });
	}

	/**
	 * Attach a description.
	 * @param {string} value - the description.
	 * @returns {Schema} a new node.
	 */
	description(value) {
		return new Schema(this.kind, { ...this.meta, description: value });
	}

	/**
	 * Allow unknown keys.
	 * @returns {Schema} a new node.
	 */
	loose() {
		return new Schema(this.kind, { ...this.meta, loose: true });
	}

	/** Standard Schema validation hook. */
	get '~standard'() {
		return {
			version: 1,
			vendor: 'test-stub',
			validate: (value) => ({ value }),
		};
	}
}

const z = {
	object: (shape) => new Schema('object', { shape }),
	array: (item) => new Schema('array', { item }),
	string: () => new Schema('string'),
	number: () => new Schema('number'),
	boolean: () => new Schema('boolean'),
};

export default z;
