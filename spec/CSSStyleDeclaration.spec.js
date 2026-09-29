describe('CSSOM', function() {
describe('CSSStyleDeclaration', function() {

	it('setProperty, removeProperty, cssText, getPropertyValue, getPropertyPriority', function() {
		var d = new CSSOM.CSSStyleDeclaration;

		d.setProperty('color', 'purple');
		expect(d).toEqualOwnProperties({
			0: 'color',
			length: 1,
			parentRule: null,
			color: 'purple',
			_importants: {
				color: undefined
			}
		});

		d.setProperty('width', '128px', 'important');
		expect(d).toEqualOwnProperties({
			0: 'color',
			1: 'width',
			length: 2,
			parentRule: null,
			color: 'purple',
			width: '128px',
			_importants: {
				color: undefined,
				width: 'important'
			}
		});

		d.setProperty('opacity', 0);

		expect(d.cssText).toBe('color: purple; width: 128px !important; opacity: 0;');

		expect(d.getPropertyValue('color')).toBe('purple');
		expect(d.getPropertyValue('width')).toBe('128px');
		expect(d.getPropertyValue('opacity')).toBe('0');
		expect(d.getPropertyValue('position')).toBe('');

		expect(d.getPropertyPriority('color')).toBe('');
		expect(d.getPropertyPriority('width')).toBe('important');
		expect(d.getPropertyPriority('position')).toBe('');

		d.setProperty('color', 'green');
		d.removeProperty('width');
		d.removeProperty('opacity');

		expect(d.cssText).toBe('color: green;');
	});

	given('color: pink; outline: 2px solid red;', function(cssText) {
		var d = new CSSOM.CSSStyleDeclaration;
		d.cssText = cssText;
		expect(d.cssText).toBe(cssText);
	});

	// CVE-2026-93752: declaration names share the instance namespace with the
	// declaration's own fields and inherited members. A declaration named
	// "length" used to overwrite the declaration count.
	it('setProperty ignores names of internal fields and inherited members', function() {
		var d = new CSSOM.CSSStyleDeclaration;

		d.setProperty('length', 3);
		d.setProperty('parentRule', 'x');
		d.setProperty('_importants', 'x');
		d.setProperty('cssText', 'length: 3');
		d.setProperty('setProperty', 'x');
		d.setProperty('getPropertyValue', 'x');
		d.setProperty('getPropertyPriority', 'x');
		d.setProperty('removeProperty', 'x');
		d.setProperty('constructor', 'x');
		d.setProperty('toString', 'x');
		d.setProperty('hasOwnProperty', 'x');
		d.setProperty('__proto__', 'x');
		d.setProperty('color', 'red', 'important');

		expect(d).toEqualOwnProperties({
			0: 'color',
			length: 1,
			parentRule: null,
			color: 'red',
			_importants: {
				color: 'important'
			}
		});
		expect(typeof d.setProperty).toBe('function');
		expect(typeof d.getPropertyValue).toBe('function');
		expect(d.constructor).toBe(CSSOM.CSSStyleDeclaration);
		expect(d.getPropertyPriority('color')).toBe('important');
		expect(d.cssText).toBe('color: red !important;');

		expect(d.removeProperty('color')).toBe('red');
		expect(d.length).toBe(0);
		expect(d.cssText).toBe('');
	});

	it('parsed declarations named after internal fields or inherited members are ignored', function() {
		var cssText = 'a{color: red; length: 3; parentRule: x; _importants: x; cssText: length: 3; ' +
			'setProperty: x; getPropertyValue: x; getPropertyPriority: x; constructor: x; ' +
			'toString: x; hasOwnProperty: x; __proto__: x; width: 1px}';

		var rule = CSSOM.parse(cssText).cssRules[0];
		var style = rule.style;
		expect(style.length).toBe(2);
		expect(style[0]).toBe('color');
		expect(style[1]).toBe('width');
		expect(style[2]).toBeUndefined();
		expect(style.parentRule).toBe(rule);
		expect(typeof style.setProperty).toBe('function');
		expect(typeof style.getPropertyValue).toBe('function');
		expect(style.constructor).toBe(CSSOM.CSSStyleDeclaration);
		expect(style.cssText).toBe('color: red; width: 1px;');
		expect(rule.cssText).toBe('a {color: red; width: 1px;}');

		// CSSStyleRule's own lightweight parser goes through setProperty too.
		var lightRule = CSSOM.CSSStyleRule.parse(cssText);
		expect(lightRule.style.length).toBe(2);
		expect(lightRule.style.cssText).toBe('color: red; width: 1px;');

		var clonedStyle = CSSOM.clone(CSSOM.parse(cssText)).cssRules[0].style;
		expect(clonedStyle.length).toBe(2);
		expect(clonedStyle.cssText).toBe('color: red; width: 1px;');

		var d = new CSSOM.CSSStyleDeclaration;
		d.cssText = 'length: 3; color: red';
		expect(d.length).toBe(1);
		expect(d.cssText).toBe('color: red;');
	});

	// Proof of concept from the advisory: on a vulnerable build, serializing
	// cssText builds a 2e9-entry array and the process aborts with an
	// uncatchable out-of-memory error.
	it('a{length:2000000000} cannot drive cssText serialization into an unbounded allocation', function() {
		var rule = CSSOM.parse('a{length:2000000000}').cssRules[0];
		expect(rule.style.length).toBe(0);
		expect(rule.style.cssText).toBe('');
		expect(rule.cssText).toBe('a {}');

		var d = new CSSOM.CSSStyleDeclaration;
		d.setProperty('length', 2000000000);
		expect(d.length).toBe(0);
		expect(d.cssText).toBe('');

		d.cssText = 'length: 2000000000; color: red';
		expect(d.length).toBe(1);
		expect(d.cssText).toBe('color: red;');

		rule.cssText = 'a{length: 2000000000}';
		expect(rule.style.length).toBe(0);
		expect(rule.cssText).toBe('a {}');
	});

});
});
