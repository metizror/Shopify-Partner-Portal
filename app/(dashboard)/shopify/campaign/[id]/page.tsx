import CampaignCompose from '@/components/CampaignCompose'

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CampaignCompose id={Number(id)} />
}
