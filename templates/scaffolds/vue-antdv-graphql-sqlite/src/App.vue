<template>
  <a-config-provider>
    <div class="app-shell">
      <a-layout class="layout-shell">
        <a-layout-header class="layout-header">
          <div>
            <p class="eyebrow">ShipFlow scaffold</p>
            <h1>Vue + Ant Design Vue + GraphQL foundation</h1>
          </div>
          <a-tag color="blue">Ready for implementation</a-tag>
        </a-layout-header>
        <a-layout-content class="layout-content">
          <a-row :gutter="[24, 24]">
            <a-col :xs="24" :lg="10">
              <a-card title="Movies" :bordered="false">
                <a-empty description="The movie catalog will be implemented from the verification pack." />
              </a-card>
            </a-col>
            <a-col :xs="24" :lg="14">
              <a-card title="Comments" :bordered="false">
                <p class="status-copy">
                  The design system, build tool, GraphQL dependency, and backend entrypoint are already in place.
                </p>
                <a-button type="primary">Add comment</a-button>
              </a-card>
            </a-col>
          </a-row>
        </a-layout-content>
      </a-layout>
    </div>
  </a-config-provider>
</template>
