defmodule ExporterEliteWebsiteBackend.MixProject do
  use Mix.Project

  def project do
    [
      app: :exporter_elite_website_backend,
      version: "1.0.0",
      elixir: "~> 1.14",
      start_permanent: Mix.env() == :prod,
      deps: []
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {ExporterEliteWebsiteBackend.Application, []}
    ]
  end
end
