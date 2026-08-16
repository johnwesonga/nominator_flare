export type VotingEmail = {
  html: string;
  subject: string;
  text: string;
};

export function votingEmail(
  swimmerNames: string[],
  votingUrl: string,
): VotingEmail {
  const names = swimmerNames.length === 0 ? "your swimmers" : formatNames(swimmerNames);
  const escapedNames = escapeHtml(names);
  const escapedUrl = escapeHtml(votingUrl);

  return {
    subject: "Most Inspirational Swimmer voting",
    text: [
      `It is time to vote for the team's Most Inspirational Swimmer on behalf of ${names}.`,
      "Each swimmer in your family may submit one nomination.",
      `Open your private family ballot: ${votingUrl}`,
      "Please do not forward this private voting link.",
    ].join("\n\n"),
    html: [
      "<p>It is time to vote for the team&#39;s Most Inspirational Swimmer on behalf of <strong>",
      escapedNames,
      "</strong>.</p>",
      "<p>Each swimmer in your family may submit one nomination.</p>",
      `<p><a href="${escapedUrl}">Open your private family ballot</a></p>`,
      "<p>Please do not forward this private voting link.</p>",
    ].join(""),
  };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "'": return "&#39;";
      case '"': return "&quot;";
      default: return character;
    }
  });
}

function formatNames(names: string[]): string {
  if (names.length === 1) return names[0] ?? "your swimmer";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}
