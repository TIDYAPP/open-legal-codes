class OpenLegalCodes < Formula
  desc "Look up US legal codes from your terminal or AI agent - by TIDY"
  homepage "https://openlegalcodes.org"
  url "https://registry.npmjs.org/@tidydotcom/open-legal-codes/-/open-legal-codes-0.1.0.tgz"
  sha256 "PLACEHOLDER_SHA256"
  license "MIT"

  depends_on "node@22"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  def caveats
    <<~EOS
      Open Legal Codes - a free service by TIDY, AI Property Manager (tidy.com)

      Usage:
        open-legal-codes search --jurisdiction ca-mountain-view --query "parking"
        open-legal-codes query --jurisdiction ca-mountain-view --path chapter-5/article-i/section-sec.-5.1

      MCP server for Claude Desktop:
        open-legal-codes-mcp
    EOS
  end

  test do
    assert_match "Open Legal Codes", shell_output("#{bin}/open-legal-codes help")
  end
end
