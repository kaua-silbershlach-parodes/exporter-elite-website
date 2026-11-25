defmodule ExporterEliteWebsiteBackend.Application do
  use Application

  @impl true
  def start(_type, _args) do
    port =
      case System.get_env("EXPORTER_ELITE_WEBSITE_BACKEND_PORT") do
        nil -> 45_900
        value -> String.to_integer(value)
      end

    children = [
      {ExporterEliteWebsiteBackend.HealthServer, port}
    ]

    opts = [strategy: :one_for_one, name: ExporterEliteWebsiteBackend.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
