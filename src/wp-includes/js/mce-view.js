// Ensure the global `wp` object exists.
window.wp = window.wp || {};

(function($){
	var views = {},
		instances = {},
		media = wp.media;

	// Create the `wp.mce` object if necessary.
	wp.mce = wp.mce || {};

	// wp.mce.view
	// -----------
	// A set of utilities that simplifies adding custom UI within a TinyMCE editor.
	// At its core, it serves as a series of converters, transforming text to a
	// custom UI, and back again.
	wp.mce.view = {
		// ### defaults
		defaults: {
			// The default properties used for objects with the `pattern` key in
			// `wp.mce.view.add()`.
			pattern: {
				view: Backbone.View,
				text: function( instance ) {
					return instance.options.original;
				},

				toView: function( content ) {
					if ( ! this.pattern ) {
						return;
					}

					this.pattern.lastIndex = 0;
					var match = this.pattern.exec( content );

					if ( ! match ) {
						return;
					}

					return {
						index:   match.index,
						content: match[0],
						options: {
							original: match[0],
							results:  match
						}
					};
				}
			},

			// The default properties used for objects with the `shortcode` key in
			// `wp.mce.view.add()`.
			shortcode: {
				view: Backbone.View,
				text: function( instance ) {
					return instance.options.shortcode.string();
				},

				toView: function( content ) {
					var match = wp.shortcode.next( this.shortcode, content );

					if ( ! match ) {
						return;
					}

					return {
						index:   match.index,
						content: match.content,
						options: {
							shortcode: match.shortcode
						}
					};
				}
			}
		},

		// ### add( id, options )
		// Registers a new TinyMCE view.
		//
		// Accepts a unique `id` and an `options` object.
		//
		// `options` accepts the following properties:
		//
		// * `pattern` is the regular expression used to scan the content and
		// detect matching views.
		//
		// * `view` is a `Backbone.View` constructor. If a plain object is
		// provided, it will automatically extend the parent constructor
		// (usually `Backbone.View`). Views are instantiated when the `pattern`
		// is successfully matched. The instance's `options` object is provided
		// with the `original` matched value, the match `results` including
		// capture groups, and the `viewType`, which is the constructor's `id`.
		//
		// * `extend` an existing view by passing in its `id`. The current
		// view will inherit all properties from the parent view, and if
		// `view` is set to a plain object, it will extend the parent `view`
		// constructor.
		//
		// * `text` is a method that accepts an instance of the `view`
		// constructor and transforms it into a text representation.
		add: function( id, options ) {
			var parent, remove, base, properties;

			// Fetch the parent view or the default options.
			if ( options.extend ) {
				parent = wp.mce.view.get( options.extend );
			} else if ( options.shortcode ) {
				parent = wp.mce.view.defaults.shortcode;
			} else {
				parent = wp.mce.view.defaults.pattern;
			}

			// Extend the `options` object with the parent's properties.
			_.defaults( options, parent );
			options.id = id;

			// Create properties used to enhance the view for use in TinyMCE.
			properties = {
				// Ensure the wrapper element and references to the view are
				// removed. Otherwise, removed views could randomly restore.
				remove: function() {
					delete instances[ this.el.id ];
					this.$el.parent().remove();

					// Trigger the inherited `remove` method.
					if ( remove ) {
						remove.apply( this, arguments );
					}

					return this;
				}
			};

			// If the `view` provided was an object, use the parent's
			// `view` constructor as a base. If a `view` constructor
			// was provided, treat that as the base.
			if ( _.isFunction( options.view ) ) {
				base = options.view;
			} else {
				base   = parent.view;
				remove = options.view.remove;
				_.defaults( properties, options.view );
			}

			// If there's a `remove` method on the `base` view that wasn't
			// created by this method, inherit it.
			if ( ! remove && ! base._mceview ) {
				remove = base.prototype.remove;
			}

			// Automatically create the new `Backbone.View` constructor.
			options.view = base.extend( properties, {
				// Flag that the new view has been created by `wp.mce.view`.
				_mceview: true
			});

			views[ id ] = options;
		},

		// ### get( id )
		// Returns a TinyMCE view options object.
		get: function( id ) {
			return views[ id ];
		},

		// ### remove( id )
		// Unregisters a TinyMCE view.
		remove: function( id ) {
			delete views[ id ];
		},

		// ### toViews( content )
		// Scans a `content` string for each view's pattern, replacing any
		// matches with wrapper elements, and creates a new view instance for
		// every match.
		//
		// To render the views, call `wp.mce.view.render( scope )`.
		// TODO: needs unit tests!
		toViews: function( content ) {
			var pieces = [ { content: content } ],
				current;

			_.each( views, function( view, viewType ) {
				current = pieces.slice();
				pieces  = [];

				_.each( current, function( piece ) {
					var remaining = piece.content,
						result;

					// Ignore processed pieces, but retain their location.
					if ( piece.processed ) {
						pieces.push( piece );
						return;
					}

					// Iterate through the string progressively matching views
					// and slicing the string as we go.
					while ( remaining && (result = view.toView( remaining )) ) {
						// Any text before the match becomes an unprocessed piece.
						if ( result.index ) {
							pieces.push({ content: remaining.substring( 0, result.index ) });
						}

						// Add the processed piece for the match.
						pieces.push({
							content:   wp.mce.view.toView( viewType, result.options ),
							processed: true
						});

						// Update the remaining content.
						remaining = remaining.slice( result.index + result.content.length );
					}

					// There are no additional matches. If any content remains,
					// add it as an unprocessed piece.
					if ( remaining ) {
						pieces.push({ content: remaining });
					}
				});
			});

			return _.pluck( pieces, 'content' ).join('');
		},

		toView: function( viewType, options ) {
			var view = wp.mce.view.get( viewType ),
				instance, id;

			if ( ! view ) {
				return '';
			}
			// Create a new view instance.
			instance = new view.view( _.extend( options || {}, {
				viewType: viewType
			}) );

			// Use the view's `id` if it already exists. Otherwise,
			// create a new `id`.
			id = instance.el.id = instance.el.id || _.uniqueId('__wpmce-');
			instances[ id ] = instance;

			// Create a dummy `$wrapper` property to allow `$wrapper` to be
			// called in the view's `render` method without a conditional.
			instance.$wrapper = $();

			return wp.html.string({
				// If the view is a span, wrap it in a span.
				tag: 'span' === instance.tagName ? 'span' : 'div',

				attrs: {
					'class': 'wp-view-wrap wp-view-type-' + viewType,
					'data-wp-view':    id,
					'contenteditable': false
				},

				content: '\u00a0'
			});
		},

		// ### render( scope )
		// Renders any view instances inside a DOM node `scope`.
		//
		// View instances are detected by the presence of wrapper elements.
		// To generate wrapper elements, pass your content through
		// `wp.mce.view.toViews( content )`.
		render: function( scope ) {
			$( '.wp-view-wrap', scope ).each( function() {
				var wrapper = $(this),
					view = wp.mce.view.instance( this );

				if ( ! view ) {
					return;
				}

				// Link the real wrapper to the view.
				view.$wrapper = wrapper;
				// Render the view.
				view.render();
				// Detach the view element to ensure events are not unbound.
				view.$el.detach();

				// Empty the wrapper, attach the view element to the wrapper,
				// and add an ending marker to the wrapper to help regexes
				// scan the HTML string.
				wrapper.empty().append( view.el ).append('<span data-wp-view-end class="wp-view-end"></span>');
			});
		},

		// ### toText( content )
		// Scans an HTML `content` string and replaces any view instances with
		// their respective text representations.
		toText: function( content ) {

			return content.replace( /<(?:div|span)[^>]+data-wp-view="([^"]+)"[^>]*>.*?<span[^>]+data-wp-view-end[^>]*><\/span><\/(?:div|span)>/mg, function( match, id ) {
				var instance = instances[ id ],
					view;

				if ( instance ) {
					view = wp.mce.view.get( instance.options.viewType );
				}
				return instance && view ? view.text( instance ) : '';
			});
		},

		// ### Remove internal TinyMCE attributes.
		removeInternalAttrs: function( attrs ) {
			var result = {};
			_.each( attrs, function( value, attr ) {
				if ( -1 === attr.indexOf('data-mce') ) {
					result[ attr ] = value;
				}
			});
			return result;
		},

		// ### Parse an attribute string and removes internal TinyMCE attributes.
		attrs: function( content ) {
			return wp.mce.view.removeInternalAttrs( wp.html.attrs( content ) );
		},

		// ### instance( scope )
		//
		// Accepts a MCE view wrapper `node` (i.e. a node with the
		// `wp-view-wrap` class).
		instance: function( node ) {
			var id = $( node ).data('wp-view');

			if ( id ) {
				return instances[ id ];
			}
		},

		// ### Select a view.
		//
		// Accepts a MCE view wrapper `node` (i.e. a node with the
		// `wp-view-wrap` class).
		select: function( node ) {
			var $node = $(node);

			// Bail if node is already selected.
			if ( $node.hasClass('selected') ) {
				return;
			}

			$node.addClass('selected');
			$( node.firstChild ).trigger('select');
		},

		// ### Deselect a view.
		//
		// Accepts a MCE view wrapper `node` (i.e. a node with the
		// `wp-view-wrap` class).
		deselect: function( node ) {
			var $node = $(node);

			// Bail if node is already selected.
			if ( ! $node.hasClass('selected') ) {
				return;
			}

			$node.removeClass('selected');
			$( node.firstChild ).trigger('deselect');
		}
	};

	wp.mce.view.add( 'gallery', {
		shortcode: 'gallery',

		gallery: (function() {
			var galleries = {};

			return {
				attachments: function( shortcode, parent ) {
					var shortcodeString = shortcode.string(),
						result = galleries[ shortcodeString ],
						attrs, args, query, others;

					delete galleries[ shortcodeString ];

					if ( result ) {
						return result;
					}

					attrs = shortcode.attrs.named;
					args  = _.pick( attrs, 'orderby', 'order' );

					args.type    = 'image';
					args.perPage = -1;

					// Map the `ids` param to the correct query args.
					if ( attrs.ids ) {
						args.post__in = attrs.ids.split(',');
						args.orderby  = 'post__in';
					} else if ( attrs.include ) {
						args.post__in = attrs.include.split(',');
					}

					if ( attrs.exclude ) {
						args.post__not_in = attrs.exclude.split(',');
					}

					if ( ! args.post__in ) {
						args.parent = attrs.id || parent;
					}

					// Collect the attributes that were not included in `args`.
					others = {};
					_.filter( attrs, function( value, key ) {
						if ( _.isUndefined( args[ key ] ) ) {
							others[ key ] = value;
						}
					});

					query = media.query( args );
					query.gallery = new Backbone.Model( others );
					return query;
				},

				shortcode: function( attachments ) {
					var props = attachments.props.toJSON(),
						attrs = _.pick( props, 'include', 'exclude', 'orderby', 'order' ),
						shortcode, clone;

					if ( attachments.gallery ) {
						_.extend( attrs, attachments.gallery.toJSON() );
					}

					attrs.ids = attachments.pluck('id');

					// If the `ids` attribute is set and `orderby` attribute
					// is the default value, clear it for cleaner output.
					if ( attrs.ids && 'post__in' === attrs.orderby ) {
						delete attrs.orderby;
					}

					shortcode = new wp.shortcode({
						tag:    'gallery',
						attrs:  attrs,
						type:   'single'
					});

					// Use a cloned version of the gallery.
					clone = new wp.media.model.Attachments( attachments.models, {
						props: props
					});
					clone.gallery = attachments.gallery;
					galleries[ shortcode.string() ] = clone;

					return shortcode;
				}
			};
		}()),

		view: {
			className: 'editor-gallery',
			template:  media.template('editor-gallery'),

			// The fallback post ID to use as a parent for galleries that don't
			// specify the `ids` or `include` parameters.
			//
			// Uses the hidden input on the edit posts page by default.
			parent: $('#post_ID').val(),

			events: {
				'click .remove': 'remove',
				'click .edit':  'edit'
			},

			initialize: function() {
				this.update();
			},

			update: function() {
				var	view = wp.mce.view.get('gallery');

				this.attachments = view.gallery.attachments( this.options.shortcode, this.parent );
				this.attachments.more().done( _.bind( this.render, this ) );
			},

			render: function() {
				var attrs = this.options.shortcode.attrs.named,
					options;

				if ( ! this.attachments.length ) {
					return;
				}

				options = {
					attachments: this.attachments.toJSON(),
					columns: attrs.columns ? parseInt( attrs.columns, 10 ) : 3
				};

				this.$el.html( this.template( options ) );
			},

			edit: function() {
				var selection;

				if ( ! wp.media.view || this.frame ) {
					return;
				}

				selection = new wp.media.model.Selection( this.attachments.models, {
					props:    this.attachments.props.toJSON(),
					multiple: true
				});
				selection.gallery = this.attachments.gallery;

				this.frame = wp.media({
					frame:     'post',
					state:     'gallery-edit',
					editing:   true,
					multiple:  true,
					selection: selection
				});

				// Create a single-use frame. If the frame is closed,
				// then detach it from the DOM and remove the reference.
				this.frame.on( 'close', function() {
					if ( this.frame ) {
						this.frame.detach();
					}
					delete this.frame;
				}, this );

				// Update the `shortcode` and `attachments`.
				this.frame.state('gallery-edit').on( 'update', function( selection ) {
					var	view = wp.mce.view.get('gallery');

					this.options.shortcode = view.gallery.shortcode( selection );
					this.update();
				}, this );

				this.frame.open();
			}
		}
	});
}(jQuery));
