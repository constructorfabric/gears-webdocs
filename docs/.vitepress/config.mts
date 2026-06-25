import { defineConfig } from "vitepress"

const toolkit = {
  text: "Toolkit",
  collapsed: false,
  items: [
    { text: "Overview", link: "/toolkit/" },
    { text: "Gear Overview", link: "/toolkit/00_gear_overview" },
    { text: "ToolKit Overview", link: "/toolkit/01_overview" },
    { text: "Gear Layout & SDK Pattern", link: "/toolkit/02_gear_layout_and_sdk_pattern" },
    { text: "ClientHub & Plugins", link: "/toolkit/03_clienthub_and_plugins" },
    { text: "REST Operation Builder", link: "/toolkit/04_rest_operation_builder" },
    { text: "Errors (RFC 9457)", link: "/toolkit/05_errors_rfc9457" },
    { text: "AuthN/AuthZ & Secure ORM", link: "/toolkit/06_authn_authz_secure_orm" },
    { text: "OData Pagination & Filtering", link: "/toolkit/07_odata_pagination_select_filter" },
    { text: "Lifecycle & Stateful Tasks", link: "/toolkit/08_lifecycle_stateful_tasks" },
    { text: "OoP gRPC SDK Pattern", link: "/toolkit/09_oop_grpc_sdk_pattern" },
    { text: "Checklists & Templates", link: "/toolkit/10_checklists_and_templates" },
    { text: "Database Patterns", link: "/toolkit/11_database_patterns" },
    { text: "Unit Testing", link: "/toolkit/12_unit_testing" },
    { text: "E2E Testing", link: "/toolkit/13_e2e_testing" },
  ]
};

const libraries = {
  text: "Libraries",
  collapsed: false,
  items: [
    { text: "Toolkit Libraries", link: "/reference/toolkit" },
    // Individual library pages are TODO stubs for now.
    // Re-add them here once they have real content.
  ]
};

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Gears documentation site",
  description: "Gears docs, tutorials and how-to guides",
  base: "/gears-webdocs/",
  // TODO: remove once all TODO placeholder pages are filled and toolkit
  // pages are always present (they are fetched at build time).
  ignoreDeadLinks: true,
  themeConfig: {
    siteTitle: "Gears Docs",
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Docs", link: "/intro/introduction", activeMatch: '/intro/' },
      { text: "Guides", link: "/guides/", activeMatch: '/guides/' },
      { text: "Toolkit", link: "/toolkit/", activeMatch: '/toolkit/' },
      { text: "Reference", link: "/reference/api-reference", activeMatch: '/reference/' },
    ],

    // https://vitepress.dev/reference/default-theme-sidebar
    sidebar: {
      "/intro": [
        {
          text: "Intro",
          collapsed: false,
          items: [
            { text: "What is Gears?", link: "/intro/introduction" },
            { text: "Getting Started", link: "/intro/getting-started" },
            { text: "Architecture", link: "/intro/architecture" },
            { text: "Lifecycle", link: "/intro/life-cycle" },
            { text: "Manifest", link: "/intro/manifest" },
            { text: "Plugins", link: "/intro/plugins" },
            { text: "FAQ", link: "/intro/faq" },
          ]
        },
        {
          text: "Core concepts",
          collapsed: false,
          items: [
            { text: "Gears", link: "/intro/core/gears" },
            { text: "System Gears", link: "/intro/core/system-gears" },
            { text: "SDK", link: "/intro/core/sdk" },
            { text: "Database", link: "/intro/core/database" },
            { text: "OData", link: "/intro/core/odata" },
            { text: "Rest/gRPC host", link: "/intro/core/rest-grpc-host" },
          ]
        },
        {
          text: "Resources",
          collapsed: false,
          items: [
            { text: "API reference", link: "/reference/api-reference" },
          ]
        }
      ],
      "/guides": [
        {
          text: "Guides",
          collapsed: false,
          items: [
            { text: "Overview", link: "/guides/" },
            { text: "Green Project", link: "/guides/green-project" },
            { text: "Brown Project", link: "/guides/brown-project" },
            { text: "Migration Project", link: "/guides/migration-project" },
          ]
        }
      ],
      "/toolkit": [
        toolkit,
      ],
      "/reference": [
        {
          text: "API",
          collapsed: false,
          items: [
            { text: "API reference", link: "/reference/api-reference" },
          ]
        },
        libraries,
      ]
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern: 'https://github.com/constructorfabric/gears-webdocs/edit/main/docs/:path'
    },

    lastUpdated: {
      text: "Updated at",
      formatOptions: {
        dateStyle: "short",
        timeStyle: "short"
      }
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/constructorfabric" },
    ]
  }
})
