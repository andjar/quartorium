// CommentMark.js - Final Stateful Plugin Version

import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

// Define a unique key for our plugin
export const commentHighlightPluginKey = new PluginKey('commentHighlight');

// This is our self-contained, stateful plugin.
const CommentHighlightPlugin = new Plugin({
  key: commentHighlightPluginKey,

  // This plugin will manage its own state, which includes the active ID.
  state: {
    init: () => ({ activeId: null }),
    apply: (tr, value) => {
      // Check if a transaction has a 'meta' key for this plugin
      const meta = tr.getMeta(commentHighlightPluginKey);
      console.log('CommentHighlightPlugin received transaction with meta:', meta);
      if (meta && meta.activeId !== undefined) {
        // If yes, update the activeId in the plugin's state
        console.log('Updating activeId from', value.activeId, 'to', meta.activeId);
        return { activeId: meta.activeId };
      }
      // Otherwise, return the old state
      return value;
    },
  },

  // The props will now read from the plugin's own state
  props: {
    decorations(state) {
      const { activeId } = this.getState(state);
      console.log('CommentHighlightPlugin creating decorations for activeId:', activeId);
      if (!activeId) {
        console.log('No activeId, returning empty decoration set');
        return DecorationSet.empty;
      }

      const decorations = [];
      state.doc.descendants((node, pos) => {
        if (node.marks) {
          node.marks.forEach(mark => {
            if (mark.type.name === 'comment' && mark.attrs.commentId === activeId) {
              console.log('Found matching comment mark at position', pos, 'for commentId:', mark.attrs.commentId);
              decorations.push(
                Decoration.inline(pos, pos + node.nodeSize, { class: 'comment-mark-active' })
              );
            }
          });
        }
      });
      
      console.log('Created', decorations.length, 'decorations');
      return DecorationSet.create(state.doc, decorations);
    },
  },
});

export const CommentMark = Mark.create({
  name: 'comment',

  addOptions() {
    return {
      HTMLAttributes: {
        // The default class for ANY comment mark, active or not.
        class: 'comment-mark',
      },
      onCommentClick: (commentId) => {},
    };
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: element => element.getAttribute('data-comment-id'),
        renderHTML: attributes => ({ 'data-comment-id': attributes.commentId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  // The Mark is now "dumb". It only applies its default attributes.
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setComment: (commentId) => ({ commands }) => commands.setMark(this.name, { commentId }),
      toggleComment: (commentId) => ({ commands }) => commands.toggleMark(this.name, { commentId }),
      unsetComment: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },

  // We now add TWO plugins: the click handler and our new stateful highlighter.
  addProseMirrorPlugins() {
    const self = this;
    return [
      CommentHighlightPlugin, // Add our new plugin
      new Plugin({ // The existing click handler plugin
        key: new PluginKey('commentClick'),
        props: {
          handleClick: (view, pos, event) => {
            const attrs = self.editor.getAttributes(self.name);
            const commentId = attrs.commentId;
            if (commentId && event.target?.closest('span[data-comment-id]')) {
              self.options.onCommentClick(commentId);
            }
            return false;
          },
        },
      }),
    ];
  },
});

// We only need to export the Mark now. The plugin is self-contained.
export default CommentMark;