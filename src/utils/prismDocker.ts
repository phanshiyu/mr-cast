// The Dockerfile grammar from Prism 1.30 (components/prism-docker.js, MIT, https://prismjs.com), which
// prism-react-renderer does not bundle. Copied rather than added as a dependency: it is the one file needed.
import type { Prism as PrismType } from 'prism-react-renderer';

export function addDocker(Prism: typeof PrismType) {
  // `[ \t]+(?![ \t])` keeps each quantifier atomic, which stops exponential backtracking.
  const spaceAfterBackSlash = /\\[\r\n](?:\s|\\[\r\n]|#.*(?!.))*(?![\s#]|\\[\r\n])/.source;
  const space = /(?:[ \t]+(?![ \t])(?:<SP_BS>)?|<SP_BS>)/.source.replace(/<SP_BS>/g, () => spaceAfterBackSlash);
  const string = /"(?:[^"\\\r\n]|\\(?:\r\n|[\s\S]))*"|'(?:[^'\\\r\n]|\\(?:\r\n|[\s\S]))*'/.source;
  const option = /--[\w-]+=(?:<STR>|(?!["'])(?:[^\s\\]|\\.)+)/.source.replace(/<STR>/g, () => string);
  const stringRule = { pattern: RegExp(string), greedy: true };
  const commentRule = { pattern: /(^[ \t]*)#.*/m, lookbehind: true, greedy: true };
  const re = (source: string, flags: string) =>
    RegExp(
      source.replace(/<OPT>/g, () => option).replace(/<SP>/g, () => space),
      flags,
    );

  Prism.languages.docker = {
    instruction: {
      pattern:
        /(^[ \t]*)(?:ADD|ARG|CMD|COPY|ENTRYPOINT|ENV|EXPOSE|FROM|HEALTHCHECK|LABEL|MAINTAINER|ONBUILD|RUN|SHELL|STOPSIGNAL|USER|VOLUME|WORKDIR)(?=\s)(?:\\.|[^\r\n\\])*(?:\\$(?:\s|#.*$)*(?![\s#])(?:\\.|[^\r\n\\])*)*/im,
      lookbehind: true,
      greedy: true,
      inside: {
        options: {
          pattern: re(/(^(?:ONBUILD<SP>)?\w+<SP>)<OPT>(?:<SP><OPT>)*/.source, 'i'),
          lookbehind: true,
          greedy: true,
          inside: {
            property: { pattern: /(^|\s)--[\w-]+/, lookbehind: true },
            string: [stringRule, { pattern: /(=)(?!["'])(?:[^\s\\]|\\.)+/, lookbehind: true }],
            operator: /\\$/m,
            punctuation: /=/,
          },
        },
        keyword: [
          {
            pattern: re(/(^(?:ONBUILD<SP>)?HEALTHCHECK<SP>(?:<OPT><SP>)*)(?:CMD|NONE)\b/.source, 'i'),
            lookbehind: true,
            greedy: true,
          },
          {
            pattern: re(/(^(?:ONBUILD<SP>)?FROM<SP>(?:<OPT><SP>)*(?!--)[^ \t\\]+<SP>)AS/.source, 'i'),
            lookbehind: true,
            greedy: true,
          },
          { pattern: re(/(^ONBUILD<SP>)\w+/.source, 'i'), lookbehind: true, greedy: true },
          { pattern: /^\w+/, greedy: true },
        ],
        comment: commentRule,
        string: stringRule,
        variable: /\$(?:\w+|\{[^{}"'\\]*\})/,
        operator: /\\$/m,
      },
    },
    comment: commentRule,
  };
  Prism.languages.dockerfile = Prism.languages.docker;
}
