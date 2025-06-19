import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const CommentMark = Mark.create({
  name: 'comment',

  addOptions() {
    return {
      HTMLAttributes: {},
      onCommentClick: () => {},
      activeCommentId: null, // new option
    };
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: element => element.getAttribute('data-comment-id'),
        renderHTML: attributes => {
          if (!attributes.commentId) {
            return {};
          }
          return { 'data-comment-id': attributes.commentId };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-comment-id]',
        getAttrs: element => !!element.getAttribute('data-comment-id').trim() && null,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setComment: (commentId) => ({ commands }) => {
        if (!commentId) {
          return commands.unsetMark(this.name);
        }
        return commands.setMark(this.name, { commentId });
      },
      toggleComment: (commentId) => ({ commands }) => {
        return commands.toggleMark(this.name, { commentId });
      },
      unsetComment: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      },
    };
  },

  addProseMirrorPlugins() {
    const self = this; // To access Mark options in plugin
    return [
      new Plugin({
        key: new PluginKey('commentClick'),
        props: {
          handleClick: (view, pos, event) => {
            const { schema } = view.state;
            // Ensure the node at pos is resolved correctly
            const $pos = view.state.doc.resolve(pos);
            // Check marks at the resolved position
            const marks = $pos.marks();
            const commentMark = marks.find(m => m.type === schema.marks.comment);

            if (commentMark && commentMark.attrs.commentId && event.target.closest('span[data-comment-id]')) {
              self.options.onCommentClick(commentMark.attrs.commentId);
            }
            return false;
          },
        },
      }),
      new Plugin({
        key: new PluginKey('commentHighlight'),
        state: {
          init() { return DecorationSet.empty; },
          apply(tr, oldSet, oldState, newState) {
            // Access activeCommentId via self.options
            const activeId = self.options.activeCommentId;
            if (!activeId) return DecorationSet.empty;

            const decorations = [];
            newState.doc.descendants((node, pos) => {
              if (node.isText && node.marks.length > 0) {
                node.marks.forEach(mark => {
                  if (mark.type.name === self.name && mark.attrs.commentId === activeId) {
                    decorations.push(
                      Decoration.inline(pos, pos + node.nodeSize, { class: 'comment-mark-active' })
                    );
                  }
                });
              }
            });
            return DecorationSet.create(newState.doc, decorations);
          }
        },
        props: {
          decorations(state) {
            return this.getState(state);
          }
        }
      })
    ];
  },
});

export default CommentMark;
